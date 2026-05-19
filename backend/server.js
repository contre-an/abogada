const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const dotenv = require('dotenv');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const pino = require('pino');

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;
const lawyerPhone = process.env.LAWYER_PHONE;

// ────── ESTADO WHATSAPP ──────
let qrCodeData = null;
let pairingCode = null;
let clientReady = false;
let clientStatus = 'disconnected';
let sock = null;
let reconnectTimer = null;
let isStarting = false;

function getAuthPath() {
  return process.env.BAILEYS_AUTH_PATH || '.baileys_auth';
}

function clearAuth() {
  const p = getAuthPath();
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
    console.log('Credenciales eliminadas.');
  }
}

function scheduleRestart(delayMs) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startWhatsApp();
  }, delayMs);
}

// ────── CLIENTE WHATSAPP ──────
async function startWhatsApp() {
  if (isStarting) return;
  isStarting = true;

  if (sock) {
    try { sock.ev.removeAllListeners(); } catch (_) {}
    try { sock.end(); } catch (_) {}
    sock = null;
  }

  try {
    const { state, saveCreds } = await useMultiFileAuthState(getAuthPath());
    const isRegistered = !!state.creds.registered;

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      getMessage: async () => undefined,
    });

    isStarting = false;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCodeData = qr;
        clientStatus = 'qr_ready';
        console.log('QR generado.');
      }

      if (connection === 'open') {
        clientReady = true;
        clientStatus = 'connected';
        qrCodeData = null;
        pairingCode = null;
        console.log('WhatsApp conectado y listo para enviar mensajes');
      }

      if (connection === 'close') {
        clientReady = false;
        clientStatus = 'disconnected';
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log('WhatsApp desconectado, código:', statusCode);

        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        // DisconnectReason.connectionReplaced = 440 en Baileys,
        // pero WhatsApp también envía 405 con el mismo significado
        const isRejected = statusCode === DisconnectReason.connectionReplaced
          || statusCode === 405;

        if (isRejected) {
          // Conexión rechazada por WhatsApp: detener reconexión automática.
          // El usuario debe reiniciar manualmente desde /api/qr.
          clearAuth();
          qrCodeData = null;
          pairingCode = null;
          clientStatus = 'waiting_user';
          console.log(`Conexión rechazada (${statusCode}). Ve a /api/qr para reiniciar manualmente.`);
        } else if (isLoggedOut) {
          clearAuth();
          qrCodeData = null;
          pairingCode = null;
          scheduleRestart(3000);
        } else {
          scheduleRestart(5000);
        }
      }
    });

    // Si las credenciales no están registradas, el socket ya puede recibir pairing code
    if (!isRegistered) {
      clientStatus = 'waiting_pairing';
      console.log('Sin sesión activa. Llama POST /api/link con tu número para vincular.');
    }

  } catch (err) {
    isStarting = false;
    console.error('Error iniciando WhatsApp:', err.message);
    scheduleRestart(5000);
  }
}

startWhatsApp();

process.on('uncaughtException', (err) => {
  console.error('Error no manejado:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('Promesa rechazada:', reason);
});

// ────── MIDDLEWARE ──────
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // permite forms HTML

const allowedOrigins = (process.env.ALLOWED_ORIGIN || '*')
  .split(',')
  .map(o => o.trim());

// Render inyecta RENDER_EXTERNAL_URL automáticamente — lo agregamos para
// que los forms HTML del propio servidor no sean bloqueados por CORS
if (process.env.RENDER_EXTERNAL_URL) {
  allowedOrigins.push(process.env.RENDER_EXTERNAL_URL.replace(/\/$/, ''));
}

app.use(cors({
  origin: (origin, callback) => {
    if (allowedOrigins.includes('*') || !origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origen no permitido: ${origin}`));
    }
  },
  credentials: true
}));

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permite Excel (.xlsx, .xls) o CSV'));
    }
  }
});

// ────── RUTAS ──────

/**
 * GET /api/link?phone=573239277650
 * Versión para navegador: solicita código y redirige a /api/qr para mostrarlo
 */
app.get('/api/link', async (req, res) => {
  const rawPhone = req.query?.phone;
  if (!rawPhone) return res.redirect('/api/qr');

  const digits = String(rawPhone).replace(/\D/g, '');
  if (digits.length < 10 || !sock || clientReady) return res.redirect('/api/qr');

  try {
    const code = await sock.requestPairingCode(digits);
    pairingCode = code;
    clientStatus = 'waiting_pairing';
    console.log('Código de vinculación generado:', code);
  } catch (err) {
    console.error('Error generando pairing code:', err.message);
  }
  res.redirect('/api/qr');
});

/**
 * GET /api/logout
 * Versión para navegador (botón de link)
 */
app.get('/api/logout', async (req, res) => {
  try {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (sock) {
      sock.ev.removeAllListeners();
      await sock.logout().catch(() => {});
      sock = null;
    }
    clearAuth();
    clientReady = false;
    clientStatus = 'disconnected';
    qrCodeData = null;
    pairingCode = null;
    isStarting = false;
    scheduleRestart(1000);
  } catch (_) {}
  res.redirect('/api/qr');
});

/**
 * POST /api/link
 * Solicita un código de 8 dígitos para vincular WhatsApp sin QR.
 * Body: { "phone": "573239277650" }  (código de país + número, sin +)
 */
app.post('/api/link', async (req, res) => {
  if (clientReady) {
    return res.json({ success: true, message: 'Ya está conectado.' });
  }

  const rawPhone = req.body?.phone;
  if (!rawPhone) {
    return res.status(400).json({ error: 'Envía { "phone": "57XXXXXXXXXX" } en el body.' });
  }

  const digits = String(rawPhone).replace(/\D/g, '');
  if (digits.length < 10) {
    return res.status(400).json({ error: 'Número inválido. Incluye el código de país, ej: 573239277650' });
  }

  if (!sock) {
    return res.status(503).json({ error: 'Socket no inicializado. Espera unos segundos y reintenta.' });
  }

  try {
    const code = await sock.requestPairingCode(digits);
    pairingCode = code;
    clientStatus = 'waiting_pairing';
    console.log('Código de vinculación generado:', code);
    res.json({
      success: true,
      code,
      display: code.replace(/(.{4})(.{4})/, '$1-$2'),
      instructions: 'En tu teléfono: WhatsApp → Ajustes → Dispositivos vinculados → Vincular con número de teléfono → ingresa el código'
    });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo generar el código', details: err.message });
  }
});

/**
 * GET /api/qr
 * Página de vinculación: muestra el código de pairing o el QR según disponibilidad
 */
app.get('/api/qr', async (req, res) => {
  if (clientReady) {
    return res.send(`
      <html><head><meta charset="utf-8"></head>
      <body style="font-family:sans-serif;text-align:center;padding:40px;background:#f0fdf4">
        <h2 style="color:#16a34a">✅ WhatsApp conectado</h2>
        <p>El sistema está listo para enviar mensajes.</p>
      </body></html>
    `);
  }

  if (clientStatus === 'waiting_user') {
    return res.send(`
      <html><head><meta charset="utf-8"></head>
      <body style="font-family:sans-serif;text-align:center;padding:40px;background:#fef9ec">
        <h2 style="color:#b45309">⚠️ Reinicio manual requerido</h2>
        <p style="color:#475569;max-width:440px;margin:16px auto">
          Hubo un conflicto de sesión durante el deploy.<br>
          Haz clic para reiniciar y luego vincula con tu número:
        </p>
        <a href="/api/logout"
          style="display:inline-block;padding:10px 24px;background:#b45309;color:white;
                 border-radius:8px;font-size:16px;text-decoration:none;margin-bottom:24px">
          🔄 Reiniciar sesión
        </a>
        <p style="color:#64748b;font-size:14px">
          Después del reinicio, ingresa tu número para obtener el código de vinculación:
        </p>
        <form method="GET" action="/api/link" style="margin-top:8px">
          <input name="phone" placeholder="573239277650" required
            style="padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:16px;width:200px"/>
          <button type="submit"
            style="padding:8px 16px;background:#0369a1;color:white;border:none;border-radius:8px;
                   font-size:16px;cursor:pointer;margin-left:8px">
            Obtener código
          </button>
        </form>
        <script>setTimeout(() => location.reload(), 6000)</script>
      </body></html>
    `);
  }

  if (pairingCode) {
    const display = pairingCode.replace(/(.{4})(.{4})/, '$1-$2');
    return res.send(`
      <html><head><meta charset="utf-8"></head>
      <body style="font-family:sans-serif;text-align:center;padding:40px;background:#f0f9ff">
        <h2 style="color:#0369a1">🔗 Vincula WhatsApp con este código</h2>
        <div style="font-size:48px;font-weight:bold;letter-spacing:8px;color:#0c4a6e;
                    background:#e0f2fe;padding:24px 40px;border-radius:16px;display:inline-block;margin:16px 0">
          ${display}
        </div>
        <p style="color:#475569;max-width:400px;margin:16px auto">
          En tu teléfono:<br>
          <strong>WhatsApp → Ajustes → Dispositivos vinculados<br>
          → Vincular con número de teléfono → ingresa el código</strong>
        </p>
        <p style="color:#94a3b8;font-size:13px">Esta página se recarga sola</p>
        <script>setTimeout(() => location.reload(), 5000)</script>
      </body></html>
    `);
  }

  if (qrCodeData) {
    const qrImage = await qrcode.toDataURL(qrCodeData);
    return res.send(`
      <html><head><meta charset="utf-8"></head>
      <body style="font-family:sans-serif;text-align:center;padding:40px;background:#f8fafc">
        <h2 style="color:#1e293b">Escanea para vincular WhatsApp</h2>
        <p style="color:#475569">WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
        <img src="${qrImage}" style="width:280px;height:280px;border:4px solid #e2e8f0;border-radius:12px"/>
        <p style="color:#94a3b8;font-size:13px">O usa el método de código:</p>
        <form method="GET" action="/api/link" style="margin-top:8px">
          <input name="phone" placeholder="573239277650" required
            style="padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:16px;width:200px"/>
          <button type="submit"
            style="padding:8px 16px;background:#0369a1;color:white;border:none;border-radius:8px;
                   font-size:16px;cursor:pointer;margin-left:8px">
            Obtener código
          </button>
        </form>
        <script>setTimeout(() => location.reload(), 5000)</script>
      </body></html>
    `);
  }

  // Sin QR ni pairing code todavía
  res.send(`
    <html><head><meta charset="utf-8"></head>
    <body style="font-family:sans-serif;text-align:center;padding:40px;background:#fffbeb">
      <h2 style="color:#d97706">⏳ Preparando vinculación...</h2>
      <p style="color:#475569;max-width:400px;margin:16px auto">
        El servidor está iniciando. En unos segundos podrás vincular tu WhatsApp.<br><br>
        También puedes solicitar un código ahora:
      </p>
      <form method="POST" action="/api/link" style="margin-top:8px">
        <input name="phone" placeholder="573239277650" required
          style="padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:16px;width:200px"/>
        <button type="submit"
          style="padding:8px 16px;background:#d97706;color:white;border:none;border-radius:8px;
                 font-size:16px;cursor:pointer;margin-left:8px">
          Obtener código
        </button>
      </form>
      <script>setTimeout(() => location.reload(), 4000)</script>
    </body></html>
  `);
});

/**
 * GET /api/status
 */
app.get('/api/status', (req, res) => {
  res.json({
    status: clientStatus,
    connected: clientReady,
    message: clientReady
      ? 'WhatsApp conectado y listo para enviar mensajes'
      : 'WhatsApp no está conectado — visita /api/qr'
  });
});

/**
 * POST /api/upload-excel
 */
app.post('/api/upload-excel', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    const workbook = XLSX.read(req.file.buffer);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    const phones = [];
    data.forEach(row => {
      for (let key in row) {
        const value = String(row[key]).trim();
        if (/^\+?[0-9]{10,15}$/.test(value)) {
          phones.push(value);
          break;
        }
      }
    });

    const formattedPhones = phones.map(phone => {
      const digits = phone.replace(/\D/g, '');
      if (phone.startsWith('+')) return '+' + digits;
      if (digits.startsWith('57') && digits.length >= 12) return '+' + digits;
      return '+57' + digits;
    });

    res.json({
      success: true,
      total: formattedPhones.length,
      phones: formattedPhones,
      message: `Se extrajeron ${formattedPhones.length} números de teléfono`
    });

  } catch (error) {
    res.status(500).json({ error: 'Error al procesar el archivo', details: error.message });
  }
});

/**
 * POST /api/send-messages
 */
app.post('/api/send-messages', async (req, res) => {
  try {
    const { phones, messageTemplate } = req.body;

    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({ error: 'Lista de teléfonos vacía' });
    }

    if (!clientReady || !sock) {
      return res.status(503).json({
        error: 'WhatsApp no está conectado',
        details: 'Visita /api/qr para vincular el dispositivo primero'
      });
    }

    const results = [];
    let successful = 0;
    let failed = 0;

    for (const phone of phones) {
      try {
        const digits = phone.replace(/\D/g, '');
        const jid = `${digits}@s.whatsapp.net`;
        const text = messageTemplate ||
          `¡Hola! Te estamos contactando sobre tu cartera. Comunícate con nosotros al: ${lawyerPhone}`;

        await sock.sendMessage(jid, { text });

        results.push({ phone, status: 'enviado', timestamp: new Date() });
        successful++;
      } catch (error) {
        results.push({ phone, status: 'error', error: error.message, timestamp: new Date() });
        failed++;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    res.json({
      success: true,
      summary: { total: phones.length, successful, failed },
      results
    });

  } catch (error) {
    res.status(500).json({ error: 'Error al enviar mensajes', details: error.message });
  }
});

/**
 * POST /api/logout
 */
app.post('/api/logout', async (req, res) => {
  try {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (sock) {
      sock.ev.removeAllListeners();
      await sock.logout().catch(() => {});
      sock = null;
    }

    clearAuth();
    clientReady = false;
    clientStatus = 'disconnected';
    qrCodeData = null;
    pairingCode = null;
    isStarting = false;

    scheduleRestart(1000);

    res.json({ success: true, message: 'Sesión cerrada. Visita /api/qr para vincular de nuevo.' });
  } catch (error) {
    res.status(500).json({ error: 'Error al cerrar sesión', details: error.message });
  }
});

/**
 * GET /api/test
 */
app.get('/api/test', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Servidor funcionando correctamente',
    whatsappStatus: clientStatus,
    lawyerPhone
  });
});

// ────── MANEJO DE ERRORES ──────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor', details: err.message });
});

// ────── INICIAR SERVIDOR ──────
app.listen(port, () => {
  console.log(`Servidor ejecutándose en http://localhost:${port}`);
  console.log(`Teléfono de la abogada: ${lawyerPhone}`);
  console.log(`Vinculación: POST /api/link con { phone: "57XXXXXXXXXX" }`);
});
