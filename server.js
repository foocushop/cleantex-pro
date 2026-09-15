'use strict';
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const https   = require('https');
const multer  = require('multer');

const app           = express();
const PORT          = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ─── Paths ────────────────────────────────────────────────────────────────────
const DATA_DIR    = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR  = path.join(__dirname, 'public');

[DATA_DIR, UPLOADS_DIR, PUBLIC_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const REQUESTS_FILE      = path.join(DATA_DIR, 'requests.json');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');
const SETTINGS_FILE      = path.join(DATA_DIR, 'settings.json');

// ─── Environment ──────────────────────────────────────────────────────────────
const ENV_ADMIN_PIN   = process.env.ADMIN_PIN   || null;
const GITHUB_TOKEN    = process.env.GITHUB_TOKEN || null;
const GITHUB_REPO     = process.env.GITHUB_REPO  || 'foocushop/cleantex-pro';
const GITHUB_BRANCH   = process.env.GITHUB_BRANCH || 'main';
const USE_GITHUB      = !!GITHUB_TOKEN;

console.log(`[CleanTex Pro] Mode: ${IS_PRODUCTION ? 'PRODUCTION' : 'DÉVELOPPEMENT'} | Port: ${PORT}`);
console.log(`[CleanTex Pro] Stockage: ${USE_GITHUB ? `GitHub (${GITHUB_REPO})` : 'Fichiers locaux'}`);

// ═══════════════════════════════════════════════════════════════════════════════
//  GITHUB STORAGE LAYER
//  Toutes les données (requests, notifications, settings) sont stockées dans
//  le repo GitHub sous data/*.json. Chaque écriture = un commit automatique.
//  Lecture = depuis le cache mémoire (rafraîchi toutes les 60s ou après write).
// ═══════════════════════════════════════════════════════════════════════════════

/** In-memory cache: key = 'requests' | 'notifications' | 'settings' */
const cache = {
  requests:      { data: null, sha: null, ts: 0 },
  notifications: { data: null, sha: null, ts: 0 },
  settings:      { data: null, sha: null, ts: 0 }
};

const FILE_MAP = {
  requests:      'data/requests.json',
  notifications: 'data/notifications.json',
  settings:      'data/settings.json'
};

const LOCAL_MAP = {
  requests:      REQUESTS_FILE,
  notifications: NOTIFICATIONS_FILE,
  settings:      SETTINGS_FILE
};

/** Low-level: call GitHub Contents API */
function githubRequest(method, ghPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/contents/${ghPath}`,
      method,
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'CleanTexPro/2.0',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      },
      timeout: 8000
    };

    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('GitHub API timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

/** Read a file from GitHub; returns { data (parsed), sha } */
async function githubRead(key) {
  const ghPath = FILE_MAP[key];
  try {
    const { status, body } = await githubRequest('GET', ghPath);
    if (status === 200 && body.content) {
      const json = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
      return { data: json, sha: body.sha };
    }
    if (status === 404) {
      return { data: null, sha: null }; // file doesn't exist yet
    }
    throw new Error(`GitHub GET ${ghPath} → HTTP ${status}`);
  } catch (err) {
    console.warn(`[GitHub Storage] Read error (${key}): ${err.message}`);
    return { data: null, sha: null };
  }
}

/** Write (commit) a file to GitHub */
async function githubWrite(key, data, commitMsg) {
  const ghPath  = FILE_MAP[key];
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const sha     = cache[key].sha; // may be null for first write

  const body = {
    message: commitMsg || `update: ${ghPath} via CleanTex Pro`,
    content,
    branch: GITHUB_BRANCH,
    ...(sha ? { sha } : {})
  };

  try {
    const { status, body: resp } = await githubRequest('PUT', ghPath, body);
    if (status === 200 || status === 201) {
      cache[key].sha = resp.content?.sha || sha;
      console.log(`[GitHub Storage] Commit OK: ${commitMsg || ghPath}`);
      return true;
    }
    // Conflict (409): someone else wrote — refresh SHA and retry once
    if (status === 409 || status === 422) {
      console.warn(`[GitHub Storage] SHA conflict on ${key}, refreshing…`);
      const fresh = await githubRead(key);
      if (fresh.sha) {
        cache[key].sha = fresh.sha;
        body.sha = fresh.sha;
        const { status: s2 } = await githubRequest('PUT', ghPath, body);
        if (s2 === 200 || s2 === 201) return true;
      }
    }
    console.error(`[GitHub Storage] Write failed (${key}): HTTP ${status}`);
    return false;
  } catch (err) {
    console.error(`[GitHub Storage] Write error (${key}): ${err.message}`);
    return false;
  }
}

// ─── High-level storage API ───────────────────────────────────────────────────

const CACHE_TTL_MS = 60 * 1000; // 60s cache validity

/** Read data (from cache, refresh if stale) */
async function readData(key, fallback) {
  const c = cache[key];
  const now = Date.now();

  // If cache is fresh (< 60s), return immediately
  if (c.data !== null && (now - c.ts) < CACHE_TTL_MS) {
    return c.data;
  }

  if (USE_GITHUB) {
    const { data, sha } = await githubRead(key);
    if (data !== null) {
      c.data = data;
      c.sha  = sha;
      c.ts   = now;
      return c.data;
    }
    // If GitHub read failed but we have stale cache, return it
    if (c.data !== null) return c.data;
  }

  // Local file fallback (dev mode or GitHub unavailable)
  return readLocalFile(LOCAL_MAP[key], fallback);
}

/** Write data (update cache immediately + async commit to GitHub) */
async function writeData(key, data, commitMsg) {
  // Update cache immediately for instant API responses
  cache[key].data = data;
  cache[key].ts   = Date.now();

  if (USE_GITHUB) {
    // Fire-and-forget — don't block the HTTP response
    githubWrite(key, data, commitMsg).catch(err =>
      console.error(`[GitHub Storage] Async write failed (${key}):`, err.message)
    );
  } else {
    // Local fallback
    writeLocalFile(LOCAL_MAP[key], data);
  }
}

/** Initialise cache from GitHub (or local) on server start */
async function initStorage() {
  console.log('[CleanTex Pro] Chargement des données depuis GitHub…');
  for (const key of ['settings', 'requests', 'notifications']) {
    const fallback = key === 'settings' ? getDefaultSettings() : [];
    const data = await readData(key, fallback);
    if (data !== null) {
      cache[key].data = data;
      cache[key].ts   = Date.now();
    }
  }

  // Seed demo data if requests are empty
  if (!cache.requests.data || cache.requests.data.length === 0) {
    await seedDemoData();
  }

  console.log(`[CleanTex Pro] Stockage initialisé — ${(cache.requests.data || []).length} demande(s) chargée(s)`);
}

// ─── Local file helpers (fallback / dev mode) ─────────────────────────────────

function readLocalFile(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf8');
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8') || '[]');
  } catch (err) {
    console.error(`[Local] Read error ${filePath}:`, err.message);
    return fallback;
  }
}

function writeLocalFile(filePath, data) {
  try {
    const tmp = `${filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    console.error(`[Local] Write error ${filePath}:`, err.message);
  }
}

// ─── Default data ─────────────────────────────────────────────────────────────

function getDefaultSettings() {
  return {
    adminEmail:      'contact@cleantex-pro.fr',
    whatsappNumber:  '33184742000',
    companyPhone:    '01 84 74 20 00',
    webhookUrl:      '',
    webhookEnabled:  false,
    autoSoundAlerts: true,
    adminPin:        '2026'
  };
}

async function getSettings() {
  const defaults = getDefaultSettings();
  const s = await readData('settings', defaults);
  if (!s || typeof s !== 'object' || Array.isArray(s)) {
    await writeData('settings', defaults, 'init: settings par défaut');
    return defaults;
  }
  return { ...defaults, ...s };
}

async function seedDemoData() {
  const seed = [
    {
      id: 'DEV-2026-1001',
      createdAt: new Date(Date.now() - 3600000 * 3).toISOString(),
      nom: 'Elodie Laurent', telephone: '06 45 89 12 34', email: 'elodie.laurent@gmail.com',
      service: 'Canapé & Fauteuils', details: 'Canapé d\'angle 5 places en tissu beige',
      ville: 'Paris 15ème (75015)', dateSouhaitee: '2026-09-18',
      message: 'Présence de plusieurs auréoles d\'eau et taches de chocolat. Merci !',
      photos: [], status: 'Nouveau', notesInternes: 'À rappeler vers 18h', estimatifPrix: 'À partir de 69€'
    },
    {
      id: 'DEV-2026-1002',
      createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
      nom: 'Marc Benhamou', telephone: '07 82 11 90 45', email: 'marc.benhamou@outlook.fr',
      service: 'Matelas & Sommiers', details: '2 matelas 160x200',
      ville: 'Boulogne-Billancourt (92100)', dateSouhaitee: '2026-09-19',
      message: 'Désinfection et détachage complet pour emménagement.',
      photos: [], status: 'Devis envoyé', notesInternes: 'Devis 110€ envoyé par SMS.', estimatifPrix: 'À partir de 49€'
    },
    {
      id: 'DEV-2026-1003',
      createdAt: new Date(Date.now() - 3600000 * 48).toISOString(),
      nom: 'Sophie Delattre', telephone: '06 12 34 56 78', email: 'sophie.delattre@free.fr',
      service: 'Tapis & Moquettes', details: 'Grand tapis persan laine 3x2m',
      ville: 'Neuilly-sur-Seine (92200)', dateSouhaitee: '2026-09-16',
      message: 'Tapis ancien taché par du café. Traitement délicat requis.',
      photos: [], status: 'Terminé', notesInternes: 'Client ravi, a laissé 5 étoiles Google.', estimatifPrix: 'À partir de 39€'
    }
  ];

  const notifs = [{
    id: 'NOTIF-1', timestamp: new Date().toISOString(), type: 'EMAIL_SIMULATION',
    subject: '🔔 Nouvelle demande - Elodie Laurent (#DEV-2026-1001)',
    to: 'contact@cleantex-pro.fr',
    content: 'Nouvelle demande reçue pour Canapé & Fauteuils à Paris 15ème. Tél: 06 45 89 12 34.'
  }];

  await writeData('requests', seed, 'init: données de démonstration');
  await writeData('notifications', notifs, 'init: notification de démonstration');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WEBHOOK DISPATCHER
// ═══════════════════════════════════════════════════════════════════════════════

function dispatchWebhook(reqData, settings) {
  if (!settings.webhookEnabled || !settings.webhookUrl) return;
  try {
    const urlObj  = new URL(settings.webhookUrl);
    const isHttps = urlObj.protocol === 'https:';
    const httpLib = isHttps ? require('https') : require('http');
    const payload = JSON.stringify({
      event: 'new_quote_request', id: reqData.id, timestamp: reqData.createdAt,
      client: { nom: reqData.nom, telephone: reqData.telephone, email: reqData.email, ville: reqData.ville },
      prestation: { service: reqData.service, details: reqData.details, estimation: reqData.estimatifPrix },
      content: `🔔 **Nouvelle demande CleanTex Pro #${reqData.id}** — ${reqData.nom} | ${reqData.service} | ${reqData.ville}`,
      embeds: [{
        title: `${reqData.service} — ${reqData.nom}`,
        description: reqData.message || 'Aucun message.',
        color: 48038,
        fields: [
          { name: '👤 Client', value: `${reqData.nom}\n📞 ${reqData.telephone}\n✉️ ${reqData.email || 'N/A'}`, inline: true },
          { name: '📍 Lieu', value: reqData.ville, inline: true },
          { name: '💰 Estimation', value: reqData.estimatifPrix || 'Sur devis', inline: true }
        ],
        footer: { text: `CleanTex Pro • ${new Date().toLocaleString('fr-FR')}` }
      }]
    });
    const opts = {
      hostname: urlObj.hostname, port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + (urlObj.search || ''), method: 'POST', timeout: 5000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'User-Agent': 'CleanTexPro/2.0' }
    };
    const r = httpLib.request(opts, res => { res.on('data', () => {}); });
    r.on('error', e => console.warn('[Webhook]', e.message));
    r.on('timeout', () => r.destroy());
    r.write(payload); r.end();
  } catch (err) { console.warn('[Webhook] Error:', err.message); }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MULTER (photo uploads)
// ═══════════════════════════════════════════════════════════════════════════════

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|webp|heic/.test(path.extname(file.originalname).toLowerCase().replace('.', ''))
            || /jpeg|jpg|png|webp|heic/.test(file.mimetype);
    ok ? cb(null, true) : cb(new Error('Seules les images (JPG, PNG, WEBP) sont autorisées.'));
  }
});

function handleUpload(req, res, next) {
  upload.array('photos', 4)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE'      ? 'Fichier trop volumineux (max 10 Mo).'
                : err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Maximum 4 photos autorisées.'
                : err.message;
      return res.status(400).json({ success: false, error: msg });
    }
    if (err) return res.status(400).json({ success: false, error: err.message });
    next();
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── Admin Auth ───────────────────────────────────────────────────────────────
const ADMIN_TOKENS = new Set();

function isAdminAuthenticated(req) {
  const raw   = req.headers.cookie || '';
  const match = raw.match(/(?:^|;\s*)cleantex_admin_token=([^;]+)/);
  return match ? ADMIN_TOKENS.has(decodeURIComponent(match[1])) : false;
}

function requireAdminAuth(req, res, next) {
  if (isAdminAuthenticated(req)) return next();
  res.redirect('/admin-login');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// 1. Client: Submit new quote request
app.post('/api/requests', handleUpload, async (req, res) => {
  try {
    const { nom, email, telephone, service, details, ville, dateSouhaitee, message } = req.body;

    if (!nom || !telephone || !service) {
      return res.status(400).json({ success: false, error: 'Nom, Téléphone et Service sont obligatoires.' });
    }
    if (telephone.replace(/\D/g, '').length < 6) {
      return res.status(400).json({ success: false, error: 'Numéro de téléphone invalide.' });
    }

    const requests = await readData('requests', []);
    const nextSeq  = 1000 + (Array.isArray(requests) ? requests.length : 0) + 1;
    const newId    = `DEV-${new Date().getFullYear()}-${nextSeq}`;
    const photos   = req.files ? req.files.map(f => `/uploads/${f.filename}`) : [];

    const newRequest = {
      id: newId, createdAt: new Date().toISOString(),
      nom: nom.trim(), email: (email || '').trim(), telephone: telephone.trim(),
      service: service.trim(), details: (details || '').trim(),
      ville: (ville || 'Non précisé').trim(), dateSouhaitee: dateSouhaitee || '',
      message: (message || '').trim(), photos,
      status: 'Nouveau', notesInternes: '',
      estimatifPrix: calculateEstimate(service)
    };

    const updatedRequests = [newRequest, ...(Array.isArray(requests) ? requests : [])];
    await writeData('requests', updatedRequests, `nouveau: #${newId} — ${newRequest.nom} (${newRequest.service})`);

    // Log notification
    const settings = await getSettings();
    const notifications = await readData('notifications', []);
    const newNotif = {
      id: `NOTIF-${Date.now()}`, timestamp: new Date().toISOString(),
      type: 'NEW_REQUEST',
      subject: `🔔 Nouvelle demande : ${newRequest.nom} — ${newRequest.service} (${newId})`,
      to: settings.adminEmail || 'contact@cleantex-pro.fr',
      content: `Client: ${newRequest.nom} | Tél: ${newRequest.telephone} | ${newRequest.ville} | ${newRequest.service}`
    };
    await writeData(
      'notifications',
      [newNotif, ...(Array.isArray(notifications) ? notifications : [])].slice(0, 100),
      `notif: ${newId}`
    );

    dispatchWebhook(newRequest, settings);
    console.log(`[CleanTex Pro] Nouvelle demande: ${newId} — ${newRequest.nom}`);

    return res.status(201).json({
      success: true,
      message: 'Votre demande a été transmise avec succès ! Nous vous recontacterons très rapidement.',
      request: newRequest
    });
  } catch (err) {
    console.error('POST /api/requests:', err);
    return res.status(500).json({ success: false, error: 'Erreur lors de l\'enregistrement. Veuillez réessayer.' });
  }
});

// 2. Admin: Get all requests (with optional filter + search)
app.get('/api/requests', async (req, res) => {
  try {
    const { status, search } = req.query;
    let requests = await readData('requests', []);
    if (!Array.isArray(requests)) requests = [];

    if (status && status !== 'Tous') {
      requests = requests.filter(r => r.status === status);
    }
    if (search) {
      const q = search.toLowerCase();
      requests = requests.filter(r =>
        [r.nom, r.telephone, r.email, r.ville, r.id, r.service]
          .some(v => v && v.toLowerCase().includes(q))
      );
    }
    return res.json({ success: true, count: requests.length, requests });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Admin: Get single request
app.get('/api/requests/:id', async (req, res) => {
  try {
    const requests = await readData('requests', []);
    const item = (Array.isArray(requests) ? requests : []).find(r => r.id === req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Demande non trouvée' });
    return res.json({ success: true, request: item });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Admin: Update request (status, notes, price)
app.patch('/api/requests/:id', async (req, res) => {
  try {
    const { status, notesInternes, estimatifPrix } = req.body;
    const requests = await readData('requests', []);
    const arr = Array.isArray(requests) ? requests : [];
    const idx = arr.findIndex(r => r.id === req.params.id);

    if (idx === -1) return res.status(404).json({ success: false, error: 'Demande non trouvée' });

    if (status !== undefined)        arr[idx].status        = status;
    if (notesInternes !== undefined)  arr[idx].notesInternes  = notesInternes;
    if (estimatifPrix !== undefined)  arr[idx].estimatifPrix  = estimatifPrix;
    arr[idx].updatedAt = new Date().toISOString();

    await writeData('requests', arr, `update: #${req.params.id} → ${status || 'notes'}`);
    return res.json({ success: true, message: 'Demande mise à jour.', request: arr[idx] });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Admin: Delete request
app.delete('/api/requests/:id', async (req, res) => {
  try {
    const requests = await readData('requests', []);
    const arr = Array.isArray(requests) ? requests : [];
    const filtered = arr.filter(r => r.id !== req.params.id);

    if (filtered.length === arr.length) {
      return res.status(404).json({ success: false, error: 'Demande non trouvée' });
    }
    await writeData('requests', filtered, `delete: #${req.params.id}`);
    return res.json({ success: true, message: 'Demande supprimée.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Admin: Stats
app.get('/api/stats', async (req, res) => {
  try {
    const requests = await readData('requests', []);
    const arr = Array.isArray(requests) ? requests : [];
    return res.json({
      success: true,
      stats: {
        total:    arr.length,
        nouveau:  arr.filter(r => r.status === 'Nouveau').length,
        enCours:  arr.filter(r => r.status === 'En cours' || r.status === 'Devis envoyé').length,
        termine:  arr.filter(r => r.status === 'Terminé').length,
        archive:  arr.filter(r => r.status === 'Archivé').length
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Admin: Notifications log
app.get('/api/notifications', async (req, res) => {
  try {
    const notifications = await readData('notifications', []);
    return res.json({ success: true, notifications: Array.isArray(notifications) ? notifications : [] });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Admin: Get settings
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await getSettings();
    return res.json({ success: true, settings });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Admin: Update settings
app.patch('/api/settings', async (req, res) => {
  try {
    const current = await getSettings();
    const { adminEmail, whatsappNumber, companyPhone, webhookUrl, webhookEnabled, autoSoundAlerts, adminPin } = req.body;

    if (adminEmail !== undefined)      current.adminEmail      = String(adminEmail).trim();
    if (whatsappNumber !== undefined)  current.whatsappNumber  = String(whatsappNumber).trim().replace(/\s+/g, '');
    if (companyPhone !== undefined)    current.companyPhone    = String(companyPhone).trim();
    if (webhookUrl !== undefined)      current.webhookUrl      = String(webhookUrl).trim();
    if (webhookEnabled !== undefined)  current.webhookEnabled  = Boolean(webhookEnabled);
    if (autoSoundAlerts !== undefined) current.autoSoundAlerts = Boolean(autoSoundAlerts);
    if (adminPin !== undefined && String(adminPin).trim().length >= 4) {
      current.adminPin = String(adminPin).trim();
    }

    await writeData('settings', current, 'update: paramètres admin');
    return res.json({ success: true, message: 'Paramètres mis à jour.', settings: current });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Admin: Test notification
app.post('/api/settings/test-notification', async (req, res) => {
  try {
    const settings = await getSettings();
    const testReq = {
      id: `TEST-${Date.now()}`, createdAt: new Date().toISOString(),
      nom: 'Client Test', telephone: '06 00 00 00 00',
      email: settings.adminEmail, service: 'Canapé & Fauteuils',
      ville: 'Paris', message: 'Test de réception — système 100% opérationnel.',
      photos: [], status: 'Nouveau', estimatifPrix: 'Sur devis'
    };

    const notifications = await readData('notifications', []);
    const newNotif = {
      id: `NOTIF-${Date.now()}`, timestamp: new Date().toISOString(), type: 'TEST_ALERT',
      subject: `🔔 Test de réception CleanTex Pro (${testReq.id})`,
      to: settings.adminEmail || 'contact@cleantex-pro.fr',
      content: 'Test d\'alerte déclenché depuis l\'interface admin. Canal de réception opérationnel.'
    };

    await writeData(
      'notifications',
      [newNotif, ...(Array.isArray(notifications) ? notifications : [])].slice(0, 100),
      'test: notification admin'
    );

    if (settings.webhookEnabled && settings.webhookUrl) {
      dispatchWebhook(testReq, settings);
    }

    return res.json({ success: true, message: 'Notification de test envoyée !', notification: newNotif });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Auth Routes ──────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  try {
    const { pin, password } = req.body;
    const inputPin  = String(pin || password || '').trim();
    const settings  = await getSettings();
    const validPin  = String(ENV_ADMIN_PIN || settings.adminPin || '2026').trim();

    if (inputPin && inputPin === validPin) {
      const token = `ctx_auth_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      ADMIN_TOKENS.add(token);
      setTimeout(() => ADMIN_TOKENS.delete(token), 8 * 60 * 60 * 1000); // 8h
      return res.json({ success: true, message: 'Authentification réussie.', token });
    }
    return res.status(401).json({ success: false, error: 'Code PIN incorrect. Accès refusé.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/change-pin', async (req, res) => {
  try {
    const { currentPin, newPin } = req.body;
    const settings = await getSettings();
    const validPin = String(ENV_ADMIN_PIN || settings.adminPin || '2026').trim();

    if (String(currentPin).trim() !== validPin) {
      return res.status(401).json({ success: false, error: 'Code PIN actuel incorrect.' });
    }
    if (!newPin || String(newPin).trim().length < 4) {
      return res.status(400).json({ success: false, error: 'Le nouveau PIN doit comporter au moins 4 caractères.' });
    }

    settings.adminPin = String(newPin).trim();
    await writeData('settings', settings, 'security: changement de PIN admin');
    return res.json({ success: true, message: 'Code PIN mis à jour avec succès.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const raw   = req.headers.cookie || '';
  const match = raw.match(/(?:^|;\s*)cleantex_admin_token=([^;]+)/);
  if (match) ADMIN_TOKENS.delete(decodeURIComponent(match[1]));
  res.clearCookie('cleantex_admin_token');
  return res.json({ success: true, message: 'Déconnecté avec succès.' });
});

// ─── Protect admin API routes ─────────────────────────────────────────────────

app.use('/api/requests', (req, res, next) => {
  if (req.method === 'POST') return next(); // client form submission — public
  if (!isAdminAuthenticated(req)) {
    return res.status(401).json({ success: false, error: 'Non autorisé. Connectez-vous via /admin-login.' });
  }
  next();
});

app.use(['/api/stats', '/api/notifications', '/api/settings'], (req, res, next) => {
  if (!isAdminAuthenticated(req)) {
    return res.status(401).json({ success: false, error: 'Non autorisé.' });
  }
  next();
});

// ─── Page Routes ──────────────────────────────────────────────────────────────

app.get('/',            (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/admin-login', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin-login.html')));
app.get('/admin',       requireAdminAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    storage: USE_GITHUB ? `github:${GITHUB_REPO}` : 'local',
    env: process.env.NODE_ENV || 'development'
  });
});

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  if (res.headersSent) return next(err);
  return res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Une erreur inattendue est survenue.'
  });
});

// ─── Price estimator ──────────────────────────────────────────────────────────

function calculateEstimate(service) {
  if (!service) return 'Sur devis';
  const s = service.toLowerCase();
  if (s.includes('matelas'))              return 'À partir de 49€';
  if (s.includes('canap'))               return 'À partir de 69€';
  if (s.includes('tapis') || s.includes('moquette')) return 'À partir de 39€';
  if (s.includes('auto') || s.includes('voiture'))   return 'À partir de 59€';
  if (s.includes('pack'))                return 'À partir de 119€';
  return 'Sur devis';
}

// ═══════════════════════════════════════════════════════════════════════════════
//  START SERVER
// ═══════════════════════════════════════════════════════════════════════════════

if (require.main === module) {
  // Initialize storage (load from GitHub or local files) BEFORE accepting requests
  initStorage().then(() => {
    app.listen(PORT, () => {
      console.log('====================================================');
      console.log(` CleanTex Pro  —  http://localhost:${PORT}`);
      console.log(` Admin         —  http://localhost:${PORT}/admin-login`);
      console.log(` Health        —  http://localhost:${PORT}/health`);
      console.log(` Stockage      —  ${USE_GITHUB ? `GitHub (${GITHUB_REPO})` : 'Fichiers locaux'}`);
      console.log('====================================================');

      // Self-ping anti-dormance Render (14 min interval)
      const pingUrl = process.env.RENDER_EXTERNAL_URL
        ? `${process.env.RENDER_EXTERNAL_URL}/health`
        : null;

      if (pingUrl) {
        setInterval(() => {
          const mod = pingUrl.startsWith('https') ? require('https') : require('http');
          mod.get(pingUrl, r => {
            console.log(`[Self-Ping] ${new Date().toISOString()} — ${r.statusCode}`);
          }).on('error', e => console.warn(`[Self-Ping] ${e.message}`));
        }, 14 * 60 * 1000);
        console.log(` Self-ping actif → ${pingUrl}`);
      }
    });
  }).catch(err => {
    console.error('[FATAL] Impossible d\'initialiser le stockage:', err.message);
    process.exit(1);
  });
}

module.exports = app;
