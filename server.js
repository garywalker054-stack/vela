'use strict';

/*
 * Vela — full-stack server
 * - Public landing page that renders models + media uploaded from the admin portal
 * - Admin portal (password-protected) to add models, upload images/GIFs, upload an APK
 * - Real analytics: website views, clicks, and APK downloads (totals + 30-day daily series)
 *
 * Storage is a single JSON file (data/db.json); uploaded files live in /uploads.
 * All dependencies are pure JavaScript — no native build step required.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'vela-admin';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

if (!process.env.ADMIN_PASSWORD) {
  console.warn('\n  ⚠  ADMIN_PASSWORD not set — using the default "vela-admin".');
  console.warn('     Set a real one before exposing this to the internet:');
  console.warn('     PowerShell:  $env:ADMIN_PASSWORD="your-strong-password"; npm start\n');
}
const ADMIN_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 10);

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Tiny JSON "database"
// ---------------------------------------------------------------------------
const DEFAULT_DB = {
  models: [],
  apk: null, // { filename, originalName, size, version, uploadedAt }
  stats: {
    views: 0,
    clicks: 0,
    downloads: 0,
    daily: {} // 'YYYY-MM-DD' -> { views, clicks, downloads }
  }
};

function loadDB() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Object.assign({}, DEFAULT_DB, parsed, {
      stats: Object.assign({}, DEFAULT_DB.stats, parsed.stats)
    });
  } catch (err) {
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
}

let db = loadDB();
let saveTimer = null;
function saveDB() {
  // debounce writes so bursts of tracking hits don't thrash the disk
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), (e) => {
      if (e) console.error('Failed to persist db.json:', e.message);
    });
  }, 250);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
function bump(metric, n = 1) {
  db.stats[metric] = (db.stats[metric] || 0) + n;
  const d = today();
  if (!db.stats.daily[d]) db.stats.daily[d] = { views: 0, clicks: 0, downloads: 0 };
  db.stats.daily[d][metric] = (db.stats.daily[d][metric] || 0) + n;
  saveDB();
}
function dailySeries(days = 30) {
  const out = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const row = db.stats.daily[key] || { views: 0, clicks: 0, downloads: 0 };
    out.push({ date: key, views: row.views || 0, clicks: row.clicks || 0, downloads: row.downloads || 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Uploads (multer)
// ---------------------------------------------------------------------------
function safeName(original) {
  const ext = path.extname(original).toLowerCase().replace(/[^.a-z0-9]/g, '');
  return crypto.randomBytes(10).toString('hex') + ext;
}

const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, safeName(file.originalname))
});
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB per image/gif
  fileFilter: (req, file, cb) => {
    if (IMAGE_TYPES.has(file.mimetype)) return cb(null, true);
    cb(new Error('Only PNG, JPG, GIF, or WebP images are allowed.'));
  }
});

const apkStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, safeName(file.originalname))
});
const uploadApk = multer({
  storage: apkStorage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
  fileFilter: (req, file, cb) => {
    const okExt = path.extname(file.originalname).toLowerCase() === '.apk';
    const okMime = file.mimetype === 'application/vnd.android.package-archive' ||
      file.mimetype === 'application/octet-stream' || file.mimetype === 'application/java-archive';
    if (okExt && okMime) return cb(null, true);
    cb(new Error('Please upload a valid .apk file.'));
  }
});

function removeUpload(filename) {
  if (!filename) return;
  const p = path.join(UPLOAD_DIR, path.basename(filename));
  fs.unlink(p, () => {});
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  name: 'vela.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 /* 8h */ }
}));

// Serve uploaded images/gifs (read-only). APK is served through /download/apk so we can count it.
app.use('/uploads', express.static(UPLOAD_DIR, {
  index: false,
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

function publicModel(m) {
  return {
    id: m.id,
    name: m.name,
    role: m.role,
    description: m.description,
    media: m.media ? '/uploads/' + m.media : null,
    mediaType: m.mediaType || null,
    createdAt: m.createdAt
  };
}

// ---- auth ----
app.post('/api/login', (req, res) => {
  const password = (req.body && req.body.password) || '';
  if (bcrypt.compareSync(password, ADMIN_HASH)) {
    req.session.authed = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Incorrect password' });
});
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});
app.get('/api/me', (req, res) => {
  res.json({ authed: !!(req.session && req.session.authed) });
});

// ---- public read APIs ----
app.get('/api/models', (req, res) => {
  res.json(db.models.map(publicModel));
});
app.get('/api/apk-info', (req, res) => {
  if (!db.apk) return res.json({ available: false });
  res.json({
    available: true,
    originalName: db.apk.originalName,
    size: db.apk.size,
    version: db.apk.version || null,
    uploadedAt: db.apk.uploadedAt,
    downloads: db.stats.downloads
  });
});

// ---- analytics tracking (public) ----
app.post('/api/track/view', (req, res) => { bump('views'); res.json({ ok: true }); });
app.post('/api/track/click', (req, res) => { bump('clicks'); res.json({ ok: true }); });

// ---- APK download (public, counted) ----
app.get('/download/apk', (req, res) => {
  if (!db.apk) return res.status(404).send('No app has been published yet.');
  const p = path.join(UPLOAD_DIR, path.basename(db.apk.filename));
  if (!fs.existsSync(p)) return res.status(404).send('App file is missing.');
  bump('downloads');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.download(p, db.apk.originalName || 'vela.apk');
});

// ---- admin: stats ----
app.get('/api/stats', requireAuth, (req, res) => {
  res.json({
    totals: {
      views: db.stats.views || 0,
      clicks: db.stats.clicks || 0,
      downloads: db.stats.downloads || 0,
      models: db.models.length
    },
    series: dailySeries(30),
    apk: db.apk ? {
      originalName: db.apk.originalName,
      size: db.apk.size,
      version: db.apk.version || null,
      uploadedAt: db.apk.uploadedAt
    } : null
  });
});

// ---- admin: models CRUD ----
app.post('/api/models', requireAuth, (req, res) => {
  uploadImage.single('media')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const { name, role, description } = req.body || {};
    if (!name || !name.trim()) {
      if (req.file) removeUpload(req.file.filename);
      return res.status(400).json({ error: 'Name is required.' });
    }
    const model = {
      id: crypto.randomBytes(6).toString('hex'),
      name: String(name).trim().slice(0, 60),
      role: String(role || '').trim().slice(0, 60),
      description: String(description || '').trim().slice(0, 400),
      media: req.file ? req.file.filename : null,
      mediaType: req.file ? req.file.mimetype : null,
      createdAt: new Date().toISOString()
    };
    db.models.unshift(model);
    saveDB();
    res.json(publicModel(model));
  });
});

app.delete('/api/models/:id', requireAuth, (req, res) => {
  const idx = db.models.findIndex((m) => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [removed] = db.models.splice(idx, 1);
  removeUpload(removed.media);
  saveDB();
  res.json({ ok: true });
});

// ---- admin: APK upload ----
app.post('/api/apk', requireAuth, (req, res) => {
  uploadApk.single('apk')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file received.' });
    if (db.apk) removeUpload(db.apk.filename); // replace previous build
    db.apk = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      version: (req.body && req.body.version ? String(req.body.version).trim().slice(0, 40) : null),
      uploadedAt: new Date().toISOString()
    };
    saveDB();
    res.json({ ok: true, apk: { originalName: db.apk.originalName, size: db.apk.size, version: db.apk.version } });
  });
});

// ---- pages ----
app.use(express.static(path.join(ROOT, 'public'), { index: false }));
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'public', 'landing.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));

// generic error handler (e.g. multer errors that slipped through)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'Request failed' });
});

app.listen(PORT, () => {
  console.log('\n  ✦ Vela running');
  console.log('    Landing  →  http://localhost:' + PORT + '/');
  console.log('    Admin    →  http://localhost:' + PORT + '/admin\n');
});
