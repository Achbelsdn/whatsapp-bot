const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const { existsSync, mkdirSync, writeFile } = require("fs");
const path = require("path");
const qrcode = require("qrcode-terminal");

async function connectToWhatsApp() {
    if (!existsSync("medias")) mkdirSync("medias");

    const { state, saveCreds } = await useMultiFileAuthState("auth");
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on("creds.update", saveCreds);
    
    sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
        if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Connexion fermée, tentative de reconnexion :", shouldReconnect);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === "open") {
            console.log("✅ Bot WhatsApp connecté !");
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        const msgType = Object.keys(msg.message)[0];

        // Vérifier si c'est un message "View Once"
        if ((msgType === "imageMessage" || msgType === "videoMessage") && msg.message[msgType].viewOnce) {
            console.log("🔵 Message View Once détecté !");
            
            const buffer = await sock.downloadMediaMessage(msg);
            const fileExtension = msgType === "imageMessage" ? "jpg" : "mp4";
            const fileName = `medias/view_once_${Date.now()}.${fileExtension}`;
            
            writeFile(fileName, buffer, (err) => {
                if (err) console.error("❌ Erreur de sauvegarde :", err);
                else console.log("✅ Média View Once sauvegardé :", fileName);
            });
        }
    });
}

// Lancer le bot
connectToWhatsApp();