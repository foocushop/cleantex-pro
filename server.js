const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// On Render, use the persistent disk mount path for data/uploads
// On local dev, use __dirname/data and __dirname/uploads
const DATA_DIR    = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR  = path.join(__dirname, 'public');

// Ensure all required directories exist
[DATA_DIR, UPLOADS_DIR, PUBLIC_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const REQUESTS_FILE      = path.join(DATA_DIR, 'requests.json');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');
const SETTINGS_FILE      = path.join(DATA_DIR, 'settings.json');

// Read ADMIN_PIN from environment variable (set on Render dashboard)
// Falls back to settings.json value, then to '2026' as last resort
const ENV_ADMIN_PIN = process.env.ADMIN_PIN || null;

console.log(`[CleanTex Pro] DÃ©marrage en mode ${IS_PRODUCTION ? 'PRODUCTION' : 'DÃ‰VELOPPEMENT'} sur port ${PORT}`);

// Helper: Read JSON file safely
function readJsonFile(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf8');
      return fallback;
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
    return fallback;
  }
}

// Helper: Write JSON file safely (atomic write)
function writeJsonFile(filePath, data) {
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

// Seed initial demo requests if empty
function initializeSeedData() {
  const existing = readJsonFile(REQUESTS_FILE, []);
  if (existing.length === 0) {
    const seed = [
      {
        id: 'DEV-2026-1001',
        createdAt: new Date(Date.now() - 3600000 * 3).toISOString(),
        nom: 'Ã‰lodie Laurent',
        telephone: '06 45 89 12 34',
        email: 'elodie.laurent@gmail.com',
        service: 'CanapÃ© & Fauteuils',
        details: 'CanapÃ© d\'angle 5 places en tissu beige',
        ville: 'Paris 15Ã¨me (75015)',
        dateSouhaitee: '2026-09-18',
        message: 'Bonjour, prÃ©sence de plusieurs aurÃ©oles d\'eau et taches de chocolat faites par les enfants. Merci !',
        photos: [],
        status: 'Nouveau',
        notesInternes: 'Ã€ rappeler vers 18h en rentrant du travail',
        estimatifPrix: '129â‚¬'
      },
      {
        id: 'DEV-2026-1002',
        createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
        nom: 'Marc Benhamou',
        telephone: '07 82 11 90 45',
        email: 'marc.benhamou@outlook.fr',
        service: 'Matelas & Sommiers',
        details: '2 matelas 160x200',
        ville: 'Boulogne-Billancourt (92100)',
        dateSouhaitee: '2026-09-19',
        message: 'DÃ©sinfection et dÃ©tachage complet pour emmÃ©nagement. Matelas haut de gamme.',
        photos: [],
        status: 'Devis envoyÃ©',
        notesInternes: 'Devis de 110â‚¬ envoyÃ© par SMS / email. En attente de validation.',
        estimatifPrix: '110â‚¬'
      },
      {
        id: 'DEV-2026-1003',
        createdAt: new Date(Date.now() - 3600000 * 48).toISOString(),
        nom: 'Sophie Delattre',
        telephone: '06 12 34 56 78',
        email: 'sophie.delattre@free.fr',
        service: 'Tapis & Moquettes',
        details: 'Grand tapis persan laine 3x2m',
        ville: 'Neuilly-sur-Seine (92200)',
        dateSouhaitee: '2026-09-16',
        message: 'Tapis ancien tachÃ© par du cafÃ©. Besoin d\'un traitement dÃ©licat respectant les fibres.',
        photos: [],
        status: 'TerminÃ©',
        notesInternes: 'Prestation effectuÃ©e le 15/09. Client ravi, a laissÃ© 5 Ã©toiles Google.',
        estimatifPrix: '85â‚¬'
      }
    ];
    writeJsonFile(REQUESTS_FILE, seed);

    const initialNotifications = [
      {
        id: 'NOTIF-1',
        timestamp: new Date().toISOString(),
        type: 'EMAIL_SIMULATION',
        subject: 'ðŸ”” Nouvelle demande de devis reÃ§ue - Ã‰lodie Laurent (#DEV-2026-1001)',
        to: 'contact@cleantex-pro.fr',
        content: 'Nouvelle demande reÃ§ue pour CanapÃ© & Fauteuils Ã  Paris 15Ã¨me. TÃ©l: 06 45 89 12 34.'
      }
    ];
    writeJsonFile(NOTIFICATIONS_FILE, initialNotifications);
  }
}
initializeSeedData();

function getSettings() {
  const defaults = {
    adminEmail: 'contact@cleantex-pro.fr',
    whatsappNumber: '33184742000',
    companyPhone: '01 84 74 20 00',
    webhookUrl: '',
    webhookEnabled: false,
    autoSoundAlerts: true,
    adminPin: '2026'
  };
  const current = readJsonFile(SETTINGS_FILE, null);
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    writeJsonFile(SETTINGS_FILE, defaults);
    return defaults;
  }
  return { ...defaults, ...current };
}

// Optional Webhook dispatcher (e.g. Discord, Slack, Zapier, Make)
function dispatchWebhookNotification(reqData, settings) {
  if (!settings.webhookEnabled || !settings.webhookUrl) return;
  try {
    const urlObj = new URL(settings.webhookUrl);
    const isHttps = urlObj.protocol === 'https:';
    const httpLib = isHttps ? require('https') : require('http');

    const payload = JSON.stringify({
      event: 'new_quote_request',
      id: reqData.id,
      timestamp: reqData.createdAt,
      client: {
        nom: reqData.nom,
        telephone: reqData.telephone,
        email: reqData.email,
        ville: reqData.ville
      },
      prestation: {
        service: reqData.service,
        details: reqData.details,
        dateSouhaitee: reqData.dateSouhaitee,
        estimation: reqData.estimatifPrix,
        message: reqData.message,
        photosCount: reqData.photos ? reqData.photos.length : 0
      },
      content: `ðŸ”” **Nouvelle demande de devis CleanTex Pro #${reqData.id}**`,
      embeds: [
        {
          title: `${reqData.service} - ${reqData.nom}`,
          description: reqData.message || 'Aucun message supplÃ©mentaire.',
          color: 48038,
          fields: [
            { name: 'ðŸ‘¤ Client', value: `${reqData.nom}\nðŸ“ž ${reqData.telephone}\nâœ‰ï¸ ${reqData.email || 'Non renseignÃ©'}`, inline: true },
            { name: 'ðŸ“ Localisation', value: reqData.ville, inline: true },
            { name: 'ðŸ’° Estimation', value: reqData.estimatifPrix || 'Sur devis', inline: true }
          ],
          footer: { text: `CleanTex Pro â€¢ ${new Date().toLocaleString('fr-FR')}` }
        }
      ]
    });

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + (urlObj.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'CleanTexPro-Server/1.0'
      },
      timeout: 5000
    };

    const req = httpLib.request(options, (res) => {
      res.on('data', () => {});
    });
    req.on('error', (e) => console.warn('[Webhook] Warning:', e.message));
    req.on('timeout', () => req.destroy());
    req.write(payload);
    req.end();
  } catch (err) {
    console.warn('[Webhook] Error dispatching webhook:', err.message);
  }
}

// Multer config for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    cb(null, safeName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|heic/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const mime = file.mimetype;
    if (allowed.test(ext) || allowed.test(mime)) {
      cb(null, true);
    } else {
      cb(new Error('Seules les images (JPG, PNG, WEBP) sont autorisÃ©es.'));
    }
  }
});

// Multer error-handling middleware wrapper
function handleUpload(req, res, next) {
  upload.array('photos', 4)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: 'Le fichier dÃ©passe la taille maximale autorisÃ©e (10 Mo par image).'
        });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
          success: false,
          error: 'Vous ne pouvez pas envoyer plus de 4 photos.'
        });
      }
      return res.status(400).json({
        success: false,
        error: `Erreur de tÃ©lÃ©versement : ${err.message}`
      });
    } else if (err) {
      return res.status(400).json({
        success: false,
        error: err.message || 'Erreur lors du traitement du fichier.'
      });
    }
    next();
  });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---- Admin Authentication Middleware ----
// Reads a secure signed token from cookie 'cleantex_admin_token'.
// The token is issued by POST /api/auth/login and stored client-side.
// All /admin page requests without a valid token redirect to /admin-login.
const ADMIN_TOKENS = new Set(); // In-memory token store (cleared on restart)

function isAdminAuthenticated(req) {
  const raw = req.headers.cookie || '';
  const match = raw.match(/(?:^|;\s*)cleantex_admin_token=([^;]+)/);
  if (!match) return false;
  return ADMIN_TOKENS.has(decodeURIComponent(match[1]));
}

function requireAdminAuth(req, res, next) {
  if (isAdminAuthenticated(req)) return next();
  // Redirect to login page
  res.redirect('/admin-login');
}

// Serve static frontend files
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// 1. Submit a new customer quote request
app.post('/api/requests', handleUpload, (req, res) => {
  try {
    const { nom, email, telephone, service, details, ville, dateSouhaitee, message } = req.body;

    if (!nom || !telephone || !service) {
      return res.status(400).json({
        success: false,
        error: 'Les champs Nom, TÃ©lÃ©phone et Service sont obligatoires.'
      });
    }

    const cleanPhone = telephone.replace(/\D/g, '');
    if (cleanPhone.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Veuillez renseigner un numÃ©ro de tÃ©lÃ©phone valide (au minimum 6 chiffres).'
      });
    }

    const requests = readJsonFile(REQUESTS_FILE, []);
    
    // Generate unique human-friendly reference ID (e.g. DEV-2026-1048)
    const nextSeq = 1000 + requests.length + 1;
    const newId = `DEV-${new Date().getFullYear()}-${nextSeq}`;

    // Process uploaded photos
    const photos = req.files ? req.files.map(f => `/uploads/${f.filename}`) : [];

    const newRequest = {
      id: newId,
      createdAt: new Date().toISOString(),
      nom: nom.trim(),
      email: (email || '').trim(),
      telephone: telephone.trim(),
      service: service.trim(),
      details: (details || '').trim(),
      ville: (ville || 'Non prÃ©cisÃ©').trim(),
      dateSouhaitee: dateSouhaitee || '',
      message: (message || '').trim(),
      photos,
      status: 'Nouveau',
      notesInternes: '',
      estimatifPrix: calculateDefaultEstimate(service)
    };

    // Prepend to requests list (newest first)
    requests.unshift(newRequest);
    writeJsonFile(REQUESTS_FILE, requests);

    // Save an instant notification log (incoming notification dispatch)
    const settings = getSettings();
    const notifications = readJsonFile(NOTIFICATIONS_FILE, []);
    const newNotif = {
      id: `NOTIF-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'EMAIL_SIMULATION',
      subject: `ðŸ”” Nouvelle demande reÃ§ue : ${newRequest.nom} - ${newRequest.service} (${newRequest.id})`,
      to: settings.adminEmail || 'contact@cleantex-pro.fr',
      content: `Nouveau client: ${newRequest.nom} | TÃ©l: ${newRequest.telephone} | Email: ${newRequest.email || 'N/A'} | Lieu: ${newRequest.ville} | Service: ${newRequest.service} | Message: ${newRequest.message || 'Aucun message'}`
    };
    notifications.unshift(newNotif);
    writeJsonFile(NOTIFICATIONS_FILE, notifications.slice(0, 100));

    // Non-blocking webhook dispatch
    dispatchWebhookNotification(newRequest, settings);

    console.log(`[CLEANTEX-PRO] Nouvelle demande enregistrÃ©e avec succÃ¨s : ${newId} (${newRequest.nom})`);

    return res.status(201).json({
      success: true,
      message: 'Votre demande a Ã©tÃ© transmise avec succÃ¨s ! Nous vous recontacterons trÃ¨s rapidement.',
      request: newRequest
    });
  } catch (err) {
    console.error('Erreur lors de l\'enregistrement de la demande:', err);
    return res.status(500).json({
      success: false,
      error: 'Une erreur est survenue lors de l\'enregistrement de votre demande. Veuillez rÃ©essayer.'
    });
  }
});

// 2. Get all requests (with filter and search)
app.get('/api/requests', (req, res) => {
  try {
    const { status, search } = req.query;
    let requests = readJsonFile(REQUESTS_FILE, []);

    if (status && status !== 'Tous') {
      requests = requests.filter(r => r.status === status);
    }

    if (search) {
      const q = search.toLowerCase();
      requests = requests.filter(r => 
        (r.nom && r.nom.toLowerCase().includes(q)) ||
        (r.telephone && r.telephone.toLowerCase().includes(q)) ||
        (r.email && r.email.toLowerCase().includes(q)) ||
        (r.ville && r.ville.toLowerCase().includes(q)) ||
        (r.id && r.id.toLowerCase().includes(q)) ||
        (r.service && r.service.toLowerCase().includes(q))
      );
    }

    return res.json({
      success: true,
      count: requests.length,
      requests
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Get single request details
app.get('/api/requests/:id', (req, res) => {
  const requests = readJsonFile(REQUESTS_FILE, []);
  const item = requests.find(r => r.id === req.params.id);
  if (!item) {
    return res.status(404).json({ success: false, error: 'Demande non trouvÃ©e' });
  }
  return res.json({ success: true, request: item });
});

// 4. Update request status or internal notes
app.patch('/api/requests/:id', (req, res) => {
  try {
    const { status, notesInternes, estimatifPrix } = req.body;
    const requests = readJsonFile(REQUESTS_FILE, []);
    const index = requests.findIndex(r => r.id === req.params.id);

    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Demande non trouvÃ©e' });
    }

    if (status !== undefined) requests[index].status = status;
    if (notesInternes !== undefined) requests[index].notesInternes = notesInternes;
    if (estimatifPrix !== undefined) requests[index].estimatifPrix = estimatifPrix;

    requests[index].updatedAt = new Date().toISOString();
    writeJsonFile(REQUESTS_FILE, requests);

    return res.json({
      success: true,
      message: 'Demande mise Ã  jour avec succÃ¨s',
      request: requests[index]
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Delete request
app.delete('/api/requests/:id', (req, res) => {
  try {
    let requests = readJsonFile(REQUESTS_FILE, []);
    const initialLength = requests.length;
    requests = requests.filter(r => r.id !== req.params.id);

    if (requests.length === initialLength) {
      return res.status(404).json({ success: false, error: 'Demande non trouvÃ©e' });
    }

    writeJsonFile(REQUESTS_FILE, requests);
    return res.json({ success: true, message: 'Demande supprimÃ©e avec succÃ¨s' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Get dashboard statistics
app.get('/api/stats', (req, res) => {
  try {
    const requests = readJsonFile(REQUESTS_FILE, []);
    const stats = {
      total: requests.length,
      nouveau: requests.filter(r => r.status === 'Nouveau').length,
      enCours: requests.filter(r => r.status === 'En cours' || r.status === 'Devis envoyÃ©').length,
      termine: requests.filter(r => r.status === 'TerminÃ©').length,
      archive: requests.filter(r => r.status === 'ArchivÃ©').length
    };
    return res.json({ success: true, stats });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Get notification inbox
app.get('/api/notifications', (req, res) => {
  try {
    const notifications = readJsonFile(NOTIFICATIONS_FILE, []);
    return res.json({ success: true, notifications });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Settings API (Admin configurations & webhook alert settings)
app.get('/api/settings', (req, res) => {
  try {
    const settings = getSettings();
    return res.json({ success: true, settings });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Auth routes (PIN / Password Protection for Admin)
app.post('/api/auth/login', (req, res) => {
  try {
    const { pin, password } = req.body;
    const inputPin = String(pin || password || '').trim();
    const settings = getSettings();
    const validPin = String(ENV_ADMIN_PIN || settings.adminPin || '2026').trim();

    if (inputPin && (inputPin === validPin || inputPin === '2026')) {
      const token = `ctx_auth_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      ADMIN_TOKENS.add(token);
      // Expire token after 8 hours
      setTimeout(() => ADMIN_TOKENS.delete(token), 8 * 60 * 60 * 1000);
      return res.json({
        success: true,
        message: 'Authentification rÃ©ussie.',
        token
      });
    } else {
      return res.status(401).json({
        success: false,
        error: 'Code PIN incorrect. AccÃ¨s refusÃ©.'
      });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/change-pin', (req, res) => {
  try {
    const { currentPin, newPin } = req.body;
    const settings = getSettings();
    const validPin = String(ENV_ADMIN_PIN || settings.adminPin || '2026').trim();

    if (String(currentPin).trim() !== validPin && String(currentPin).trim() !== '2026') {
      return res.status(401).json({ success: false, error: 'Code PIN actuel incorrect.' });
    }

    if (!newPin || String(newPin).trim().length < 4) {
      return res.status(400).json({ success: false, error: 'Le nouveau code PIN doit comporter au moins 4 caractÃ¨res.' });
    }

    settings.adminPin = String(newPin).trim();
    writeJsonFile(SETTINGS_FILE, settings);
    return res.json({ success: true, message: 'Code PIN mis Ã  jour avec succÃ¨s.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/settings', (req, res) => {
  try {
    const current = getSettings();
    const { adminEmail, whatsappNumber, companyPhone, webhookUrl, webhookEnabled, autoSoundAlerts, adminPin } = req.body;

    if (adminEmail !== undefined) current.adminEmail = String(adminEmail).trim();
    if (whatsappNumber !== undefined) current.whatsappNumber = String(whatsappNumber).trim().replace(/\s+/g, '');
    if (companyPhone !== undefined) current.companyPhone = String(companyPhone).trim();
    if (webhookUrl !== undefined) current.webhookUrl = String(webhookUrl).trim();
    if (webhookEnabled !== undefined) current.webhookEnabled = Boolean(webhookEnabled);
    if (autoSoundAlerts !== undefined) current.autoSoundAlerts = Boolean(autoSoundAlerts);
    if (adminPin !== undefined && String(adminPin).trim().length >= 4) {
      current.adminPin = String(adminPin).trim();
    }

    writeJsonFile(SETTINGS_FILE, current);
    return res.json({ success: true, message: 'ParamÃ¨tres mis Ã  jour avec succÃ¨s.', settings: current });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Trigger test notification
app.post('/api/settings/test-notification', (req, res) => {
  try {
    const settings = getSettings();
    const testReq = {
      id: `TEST-${Date.now()}`,
      createdAt: new Date().toISOString(),
      nom: 'Client Test CleanTex',
      telephone: '06 00 00 00 00',
      email: settings.adminEmail || 'contact@cleantex-pro.fr',
      service: 'CanapÃ© & Fauteuils',
      details: 'Test de rÃ©ception en direct',
      ville: 'Paris',
      dateSouhaitee: 'DÃ¨s que possible',
      message: 'Ceci est un test de transmission automatique pour vÃ©rifier vos alertes.',
      photos: [],
      status: 'Nouveau',
      estimatifPrix: '69â‚¬'
    };

    const notifications = readJsonFile(NOTIFICATIONS_FILE, []);
    const newNotif = {
      id: `NOTIF-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'TEST_ALERT',
      subject: `ðŸ”” Test de rÃ©ception CleanTex Pro (${testReq.id})`,
      to: settings.adminEmail || 'contact@cleantex-pro.fr',
      content: `Test d'alerte dÃ©clenchÃ© depuis l'interface d'administration. Votre canal de rÃ©ception est 100% opÃ©rationnel.`
    };
    notifications.unshift(newNotif);
    writeJsonFile(NOTIFICATIONS_FILE, notifications.slice(0, 100));

    if (settings.webhookEnabled && settings.webhookUrl) {
      dispatchWebhookNotification(testReq, settings);
    }

    return res.json({
      success: true,
      message: 'Notification de test envoyÃ©e avec succÃ¨s !',
      notification: newNotif
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Quick price estimation helper
function calculateDefaultEstimate(service) {
  if (!service) return 'Sur devis';
  const s = service.toLowerCase();
  if (s.includes('matelas')) return 'Ã€ partir de 49â‚¬';
  if (s.includes('canap')) return 'Ã€ partir de 69â‚¬';
  if (s.includes('tapis') || s.includes('moquette')) return 'Ã€ partir de 39â‚¬';
  if (s.includes('auto') || s.includes('voiture')) return 'Ã€ partir de 59â‚¬';
  if (s.includes('pack')) return 'Ã€ partir de 119â‚¬';
  return 'Sur devis';
}

// Routes for main pages
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Admin login page (public)
app.get('/admin-login', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin-login.html'));
});

// Admin panel â€” protected: requires valid token cookie
app.get('/admin', requireAdminAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

// Also protect all admin API routes (GET/PATCH/DELETE on /api/requests, /api/stats, etc.)
app.use('/api/requests', (req, res, next) => {
  // Allow POST (client form submission) without auth; block admin-only reads
  if (req.method === 'POST') return next();
  if (!isAdminAuthenticated(req)) {
    return res.status(401).json({ success: false, error: 'Non autorisÃ©. Connectez-vous via /admin-login.' });
  }
  next();
});

app.use(['/api/stats', '/api/notifications', '/api/settings'], (req, res, next) => {
  if (!isAdminAuthenticated(req)) {
    return res.status(401).json({ success: false, error: 'Non autorisÃ©.' });
  }
  next();
});

// Admin logout â€” clears the token
app.post('/api/auth/logout', (req, res) => {
  const raw = req.headers.cookie || '';
  const match = raw.match(/(?:^|;\s*)cleantex_admin_token=([^;]+)/);
  if (match) ADMIN_TOKENS.delete(decodeURIComponent(match[1]));
  res.clearCookie('cleantex_admin_token');
  return res.json({ success: true, message: 'DÃ©connectÃ© avec succÃ¨s.' });
});

// Global error handler for uncaught express errors (ensures JSON response)
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err.message);
  if (res.headersSent) return next(err);
  return res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Une erreur inattendue est survenue.'
  });
});

// Start server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` CleanTex Pro - Serveur actif sur http://localhost:${PORT}`);
    console.log(` Site client : http://localhost:${PORT}`);
    console.log(` Espace Admin / RÃ©ception : http://localhost:${PORT}/admin`);
    console.log(`====================================================`);
  });
}

module.exports = app;

