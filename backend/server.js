const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const dotenv = require('dotenv');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;
const lawyerPhone = process.env.LAWYER_PHONE;

// ────── ESTADO WHATSAPP ──────
let qrCodeData = null;
let clientReady = false;
let clientStatus = 'disconnected';

// ────── CLIENTE WHATSAPP ──────
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: process.env.WWEBJS_AUTH_PATH || '.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  }
});

client.on('qr', (qr) => {
  qrCodeData = qr;
  clientStatus = 'qr_ready';
  console.log('QR generado — visita /api/qr para vincularlo');
});

client.on('ready', () => {
  clientReady = true;
  clientStatus = 'connected';
  qrCodeData = null;
  console.log('WhatsApp conectado y listo para enviar mensajes');
});

client.on('disconnected', () => {
  clientReady = false;
  clientStatus = 'disconnected';
  qrCodeData = null;
  console.log('WhatsApp desconectado');
  client.initialize();
});

client.initialize();

// ────── MIDDLEWARE ──────
app.use(express.json());

const allowedOrigins = (process.env.ALLOWED_ORIGIN || '*')
  .split(',')
  .map(o => o.trim());

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
 * GET /api/qr
 * Muestra el QR para vincular WhatsApp desde cualquier navegador
 */
app.get('/api/qr', async (req, res) => {
  if (clientReady) {
    return res.send(`
      <html>
      <body style="font-family:sans-serif;text-align:center;padding:40px;background:#f0fdf4">
        <h2 style="color:#16a34a">✅ WhatsApp ya está conectado</h2>
        <p>El sistema está listo para enviar mensajes.</p>
      </body>
      </html>
    `);
  }

  if (!qrCodeData) {
    return res.send(`
      <html>
      <body style="font-family:sans-serif;text-align:center;padding:40px;background:#fffbeb">
        <h2 style="color:#d97706">⏳ Generando QR...</h2>
        <p>Espera unos segundos. Esta página se recarga sola.</p>
        <script>setTimeout(() => location.reload(), 3000)</script>
      </body>
      </html>
    `);
  }

  const qrImage = await qrcode.toDataURL(qrCodeData);
  res.send(`
    <html>
    <body style="font-family:sans-serif;text-align:center;padding:40px;background:#f8fafc">
      <h2 style="color:#1e293b">Vincula tu WhatsApp</h2>
      <p style="color:#475569">En tu teléfono: <strong>WhatsApp → Dispositivos vinculados → Vincular dispositivo</strong></p>
      <img src="${qrImage}" style="width:280px;height:280px;border:4px solid #e2e8f0;border-radius:12px"/>
      <p style="color:#94a3b8;font-size:13px">El QR expira en 20 segundos — esta página se recarga automáticamente</p>
      <script>setTimeout(() => location.reload(), 20000)</script>
    </body>
    </html>
  `);
});

/**
 * GET /api/status
 * Estado actual de la conexión WhatsApp
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
 * Sube un archivo Excel y extrae los números de teléfono
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
    res.status(500).json({
      error: 'Error al procesar el archivo',
      details: error.message
    });
  }
});

/**
 * POST /api/send-messages
 * Envía mensajes masivos a una lista de números
 */
app.post('/api/send-messages', async (req, res) => {
  try {
    const { phones, messageTemplate } = req.body;

    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({ error: 'Lista de teléfonos vacía' });
    }

    if (!clientReady) {
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
        const chatId = `${digits}@c.us`;
        const text = messageTemplate ||
          `¡Hola! Te estamos contactando sobre tu cartera. Comunícate con nosotros al: ${lawyerPhone}`;

        await client.sendMessage(chatId, text);

        results.push({ phone, status: 'enviado', timestamp: new Date() });
        successful++;
      } catch (error) {
        results.push({ phone, status: 'error', error: error.message, timestamp: new Date() });
        failed++;
      }

      // Pausa de 1s entre envíos para evitar bloqueos de WhatsApp
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    res.json({
      success: true,
      summary: { total: phones.length, successful, failed },
      results
    });

  } catch (error) {
    res.status(500).json({
      error: 'Error al enviar mensajes',
      details: error.message
    });
  }
});

/**
 * GET /api/test
 * Verifica que el servidor está activo
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
  console.log(`Visita http://localhost:${port}/api/qr para vincular WhatsApp`);
});
