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
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-software-rasterizer',
      '--renderer-process-limit=1',
      '--disable-background-networking'
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

client.on('disconnected', (reason) => {
  clientReady = false;
  clientStatus = 'disconnected';
  qrCodeData = null;
  console.log('WhatsApp desconectado:', reason);
  setTimeout(() => client.initialize(), 5000);
});

client.on('auth_failure', (msg) => {
  clientReady = false;
  clientStatus = 'auth_failed';
  console.error('Error de autenticación WhatsApp:', msg);
});

process.on('uncaughtException', (err) => {
  console.error('Error no manejado:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('Promesa rechazada:', reason);
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
      <img src="${qrImage}" style="width:300px;height:300px;border:4px solid #e2e8f0;border-radius:12px"/>
      <br><br>
      <button onclick="location.reload()"
        style="padding:10px 28px;background:#1e293b;color:white;border:none;border-radius:8px;
               font-size:15px;cursor:pointer;margin-bottom:12px">
        🔄 Actualizar QR
      </button>
      <p style="color:#94a3b8;font-size:12px">
        Tienes ~40 segundos para escanear. Si expira, haz clic en Actualizar QR.
      </p>
      <script>setTimeout(() => location.reload(), 30000)</script>
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
 * Extrae contactos del Excel: teléfono (col TELEFONOS), nombre (col NOMBRE),
 * intermediario (col INTERMEDIARIO). Si no existen esas columnas busca
 * cualquier valor de 10 dígitos como fallback.
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

    function formatPhone(raw) {
      const digits = String(raw).replace(/\D/g, '');
      if (String(raw).startsWith('+')) return '+' + digits;
      if (digits.startsWith('57') && digits.length >= 12) return '+' + digits;
      if (digits.length === 10) return '+57' + digits;
      return null;
    }

    function findKey(row, ...keywords) {
      return Object.keys(row).find(k =>
        keywords.some(kw => k.toUpperCase().includes(kw))
      );
    }

    const contacts = [];
    data.forEach(row => {
      const phoneKey = findKey(row, 'TELEFON', 'CELULAR', 'MOVIL', 'PHONE');
      const nombreKey = findKey(row, 'NOMBRE', 'NAME');
      const intermediarioKey = findKey(row, 'INTERMEDIAR');

      let phone = null;
      if (phoneKey) {
        phone = formatPhone(row[phoneKey]);
      } else {
        // fallback: primer valor de exactamente 10 dígitos
        for (const key of Object.keys(row)) {
          const digits = String(row[key]).replace(/\D/g, '');
          if (digits.length === 10) { phone = '+57' + digits; break; }
        }
      }

      if (!phone) return;

      contacts.push({
        phone,
        nombre: nombreKey ? String(row[nombreKey]).trim() : '',
        intermediario: intermediarioKey ? String(row[intermediarioKey]).trim() : ''
      });
    });

    res.json({
      success: true,
      total: contacts.length,
      contacts,
      phones: contacts.map(c => c.phone), // compatibilidad legado
      message: `Se extrajeron ${contacts.length} contactos`
    });

  } catch (error) {
    res.status(500).json({
      error: 'Error al procesar el archivo',
      details: error.message
    });
  }
});

const DEFAULT_TEMPLATE =
  'Señor/a {NOMBRE}, le escribe Luisa Fernanda Ossa, abogada externa de FINAGRO, ' +
  'me gustaría comentarle las alternativas de pago disponibles respecto a la obligación ' +
  'vencida que tiene con {INTERMEDIARIO}, comuníquese al número 3237448184 o vía WhatsApp ' +
  'a este mismo número.';

/**
 * POST /api/send-messages
 * Envía mensajes masivos. Acepta contacts[] (con nombre/intermediario) o phones[] (legado).
 */
app.post('/api/send-messages', async (req, res) => {
  try {
    const { contacts, phones, messageTemplate } = req.body;

    // Normalizar a array de contactos
    let contactList = [];
    if (contacts && Array.isArray(contacts) && contacts.length > 0) {
      contactList = contacts;
    } else if (phones && Array.isArray(phones) && phones.length > 0) {
      contactList = phones.map(p => ({ phone: p, nombre: '', intermediario: '' }));
    } else {
      return res.status(400).json({ error: 'Lista de contactos vacía' });
    }

    if (!clientReady) {
      return res.status(503).json({
        error: 'WhatsApp no está conectado',
        details: 'Visita /api/qr para vincular el dispositivo primero'
      });
    }

    const template = messageTemplate || DEFAULT_TEMPLATE;
    const results = [];
    let successful = 0;
    let failed = 0;

    for (const contact of contactList) {
      const phone = contact.phone || contact;
      try {
        const digits = String(phone).replace(/\D/g, '');
        const chatId = `${digits}@c.us`;
        const text = template
          .replace(/\{NOMBRE\}/gi, contact.nombre || '')
          .replace(/\{INTERMEDIARIO\}/gi, contact.intermediario || '');

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
      summary: { total: contactList.length, successful, failed },
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
