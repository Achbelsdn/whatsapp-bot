const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const speakeasy = require('speakeasy');
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const winston = require('winston');

// Configuration du logging
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'bot_logs.json' }),
        new winston.transports.Console()
    ]
});

class WhatsAppSecureBot {
    constructor() {
        // Configuration de la base de données
        this.db = new sqlite3.Database('./secure_users.db', (err) => {
            if (err) {
                logger.error('Erreur de connexion à la base de données', err);
            }
        });

        // Création des tables sécurisées
        this.initializeDatabase();

        // Configuration du client WhatsApp
        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: 'secure-whatsapp-bot'
            }),
            puppeteer: { 
                headless: true,
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox',
                    '--disable-gpu'
                ]
            }
        });

        // Configuration du serveur Express
        this.app = express();
        this.setupMiddlewares();
        this.setupRoutes();
    }

    initializeDatabase() {
        this.db.serialize(() => {
            // Table des utilisateurs avec champs de sécurité supplémentaires
            this.db.run(`CREATE TABLE IF NOT EXISTS users (
                phone TEXT PRIMARY KEY,
                otp_secret TEXT NOT NULL,
                encrypted_data BLOB,
                attempts INTEGER DEFAULT 0,
                last_attempt DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'active'
            )`, (err) => {
                if (err) {
                    logger.error('Erreur de création de table', err);
                }
            });
        });
    }

    setupMiddlewares() {
        this.app.use(bodyParser.json());
        
        // Limitation des requêtes
        const limiter = rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 100, // Limite à 100 requêtes
            message: 'Trop de requêtes, veuillez réessayer plus tard'
        });
        this.app.use(limiter);
    }

    setupRoutes() {
        // Génération de l'OTP
        this.app.post('/generate-otp', this.generateOTP.bind(this));
        
        // Vérification de l'OTP
        this.app.post('/verify-otp', this.verifyOTP.bind(this));
    }

    generateOTP(req, res) {
        const { phone } = req.body;
        
        // Génération du secret OTP
        const secret = speakeasy.generateSecret({ length: 32 });
        
        // Chiffrement des données sensibles
        const encryptedData = this.encryptData(JSON.stringify({
            phone: phone,
            additionalInfo: 'Utilisateur WhatsApp'
        }));

        // Enregistrement sécurisé
        this.db.run(
            `INSERT OR REPLACE INTO users 
            (phone, otp_secret, encrypted_data, attempts, last_attempt) 
            VALUES (?, ?, ?, 0, datetime('now'))`,
            [phone, secret.base32, encryptedData],
            (err) => {
                if (err) {
                    logger.error('Erreur lors de la génération de l\'OTP', err);
                    return res.status(500).json({ error: 'Erreur de génération' });
                }
                
                res.json({ 
                    success: true, 
                    message: 'OTP généré avec succès',
                    hint: secret.base32.slice(-6) // Pour débogage
                });
            }
        );
    }

    verifyOTP(req, res) {
        const { phone, token } = req.body;

        this.db.get('SELECT * FROM users WHERE phone = ?', [phone], (err, user) => {
            if (err || !user) {
                return res.status(404).json({ error: 'Utilisateur non trouvé' });
            }

            // Vérification du nombre de tentatives
            if (user.attempts >= 5) {
                return res.status(403).json({ error: 'Trop de tentatives. Compte temporairement bloqué.' });
            }

            const verified = speakeasy.totp.verify({
                secret: user.otp_secret,
                encoding: 'base32',
                token: token,
                window: 1 // Permet une légère variation temporelle
            });

            if (verified) {
                // Réinitialisation des tentatives
                this.db.run('UPDATE users SET attempts = 0 WHERE phone = ?', [phone]);
                
                // Déchiffrement des données utilisateur
                const userData = JSON.parse(this.decryptData(user.encrypted_data));
                
                logger.info(`Authentification réussie pour ${phone}`);
                return res.json({ 
                    success: true, 
                    message: 'Authentification réussie',
                    userData: userData
                });
            } else {
                // Incrément des tentatives
                this.db.run('UPDATE users SET attempts = attempts + 1, last_attempt = datetime("now") WHERE phone = ?', [phone]);
                
                logger.warn(`Échec d'authentification pour ${phone}`);
                return res.status(401).json({ error: 'OTP invalide' });
            }
        });
    }

    // Méthodes de chiffrement
    encryptData(data) {
        const cipher = crypto.createCipher('aes-256-cbc', process.env.ENCRYPTION_KEY || 'default_secret_key');
        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return encrypted;
    }

    decryptData(encryptedData) {
        const decipher = crypto.createDecipher('aes-256-cbc', process.env.ENCRYPTION_KEY || 'default_secret_key');
        let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    // Configuration des événements WhatsApp
    setupWhatsAppEvents() {
        this.client.on('qr', (qr) => {
            qrcode.generate(qr, {small: true});
            logger.info('QR Code généré, veuillez scanner');
        });

        this.client.on('ready', () => {
            logger.info('Client WhatsApp connecté');
        });

        this.client.on('message', async (msg) => {
            if (msg.body === '!otp') {
                const phoneNumber = msg.from.replace('@c.us', '');
                const otp = speakeasy.totp({
                    secret: speakeasy.generateSecret().base32,
                    encoding: 'base32'
                });
                msg.reply(`Votre code OTP temporaire est : ${otp}`);
            }
        });
    }

    // Démarrage du bot
    async start() {
        try {
            // Démarrage du serveur Express
            this.app.listen(3000, () => {
                logger.info('Serveur OTP démarré sur le port 3000');
            });

            // Configuration des événements WhatsApp
            this.setupWhatsAppEvents();

            // Initialisation du client WhatsApp
            this.client.initialize();
        } catch (error) {
            logger.error('Erreur de démarrage du bot', error);
        }
    }
}

// Démarrage du bot
const bot = new WhatsAppSecureBot();
bot.start();

// Gestion des erreurs non gérées
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
});