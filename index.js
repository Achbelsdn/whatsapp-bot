const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const speakeasy = require('speakeasy');
const express = require('express');
const bodyParser = require('body-parser');

class WhatsAppOTPLogin {
    constructor() {
        // Configuration du client WhatsApp
        this.client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: { 
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        });

        // Initialisation du serveur Express
        this.app = express();
        this.app.use(bodyParser.json());

        // Stockage des secrets OTP en mémoire
        this.otpSecrets = new Map();
    }

    // Configuration des routes OTP
    setupRoutes() {
        // Générer un OTP
        this.app.post('/generate-otp', (req, res) => {
            const { phone } = req.body;
            
            // Générer un secret OTP
            const secret = speakeasy.generateSecret({ length: 32 });
            
            // Stocker le secret
            this.otpSecrets.set(phone, {
                secret: secret.base32,
                createdAt: Date.now()
            });

            res.json({
                success: true,
                phone: phone,
                hint: secret.base32.slice(-6)
            });
        });

        // Vérifier l'OTP
        this.app.post('/verify-otp', (req, res) => {
            const { phone, token } = req.body;
            const storedSecret = this.otpSecrets.get(phone);

            if (!storedSecret) {
                return res.status(400).json({ error: 'Aucun OTP généré pour ce numéro' });
            }

            // Vérifier le token
            const verified = speakeasy.totp.verify({
                secret: storedSecret.secret,
                encoding: 'base32',
                token: token,
                window: 1 // Tolérance de 1 période
            });

            if (verified) {
                // Supprimer le secret après vérification
                this.otpSecrets.delete(phone);
                
                // Connecter au WhatsApp
                this.connectWhatsApp(phone);

                res.json({ 
                    success: true, 
                    message: 'Authentification réussie' 
                });
            } else {
                res.status(401).json({ error: 'Code OTP invalide' });
            }
        });
    }

    // Méthode de connexion WhatsApp
    connectWhatsApp(phone) {
        // Événement de génération QR Code
        this.client.on('qr', (qr) => {
            qrcode.generate(qr, {small: true});
            console.log(`Scannez le QR Code pour ${phone}`);
        });

        // Événement de connexion réussie
        this.client.on('ready', () => {
            console.log(`Client WhatsApp connecté pour ${phone}`);
        });

        // Initialisation du client
        this.client.initialize();
    }

    // Démarrage du serveur et configuration
    start(port = 3000) {
        // Configuration des routes
        this.setupRoutes();

        // Démarrage du serveur Express
        this.app.listen(port, () => {
            console.log(`Serveur OTP démarré sur le port ${port}`);
        });
    }
}

// Exemple d'utilisation
const otpLogin = new WhatsAppOTPLogin();
otpLogin.start();