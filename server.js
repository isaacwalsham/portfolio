/**
 * Local + production server for your site.
 * This version only changes security headers so local dev "just works":
 *  - In development (NODE_ENV=development): CSP + HSTS are OFF to avoid HTTPS/CSP issues.
 *  - In production: CSP is ON and allows the few external assets you use (unpkg + inline).
 *
 * Functionality is otherwise unchanged: static site from /public, health check, basic
 * contact/admin endpoints (if you still use them), and SQLite for local testing.
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const session = require('express-session');

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

// If you still use the local SQLite + uploads (for dev/testing)
const DATA_DIR = process.env.DATA_DIR || ROOT;
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'contact_messages.db');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.set('trust proxy', 1);

// -------------------- Security headers (Helmet) --------------------
if (NODE_ENV === 'development') {
  // Local dev: disable CSP/HSTS so HTTP works and external scripts/styles aren't blocked.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      hsts: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
    })
  );
} else {
  // Production: keep CSP on, but allow unpkg CDN + inline (for AOS/inline styles you use).
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'", "https://unpkg.com", "'unsafe-inline'"],
          "style-src": ["'self'", "https://unpkg.com", "'unsafe-inline'"],
          "img-src": ["'self'", "data:"],
          "font-src": ["'self'", "https://unpkg.com", "data:"],
          "connect-src": ["'self'"],
          "frame-ancestors": ["'self'"],
        },
      },
    })
  );
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: 'isaac.sid',
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 4, // 4 hours
    },
  })
);

// -------------------- Static site (for local dev) --------------------
app.use(
  express.static(PUBLIC_DIR, {
    extensions: ['html'],
    setHeaders(res, filePath) {
      if (/\.html$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (/\.(css|js|png|jpe?g|gif|svg|ico|pdf|webp)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  })
);

// -------------------- Health check --------------------
app.get('/healthz', (_req, res) => res.send('ok'));

// -------------------- (Optional) Local DB + endpoints for dev --------------------
let db;
(async () => {
  db = await open({ filename: DB_FILE, driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT (datetime('now')),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      subject TEXT,
      message TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      attachment_path TEXT
    );
  `);
})().catch((e) => {
  console.error('Failed to init DB', e);
  process.exit(1);
});

// uploads (dev/testing)
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
      cb(null, `${ts}__${safe}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  return res.status(401).send('Unauthorized');
}

// Contact form (dev/testing; Netlify Forms handles this in production)
app.use('/api/contact', rateLimit({ windowMs: 60_000, max: 10 }));
app.post('/api/contact', upload.single('attachment'), async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim();
    const subject = (req.body.subject || '').trim();
    const message = (req.body.message || '').trim();
    if (!name || !email || !message) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const ip =
      (req.headers['x-forwarded-for'] || '')
        .toString()
        .split(',')[0]
        .trim() || req.socket.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';
    const attachment = req.file ? path.relative(DATA_DIR, req.file.path) : null;

    await db.run(
      `INSERT INTO messages (name, email, subject, message, ip, user_agent, attachment_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, email, subject, message, ip, ua, attachment]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Contact error:', err);
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: 'Server error' });
  }
});

// Minimal admin endpoints (dev/testing)
app.post('/admin/login', (req, res) => {
  const ok =
    (req.body.username || '') === (process.env.ADMIN_USER || 'admin') &&
    (req.body.password || '') === (process.env.ADMIN_PASS || 'change-me');
  if (ok) {
    req.session.isAdmin = true;
    return res.redirect('/admin/messages');
  }
  return res.status(401).send('Invalid credentials');
});

app.get('/admin/messages', requireAdmin, async (_req, res) => {
  const rows = await db.all(
    `SELECT id, created_at, name, email, subject, message, attachment_path
     FROM messages ORDER BY id DESC LIMIT 500`
  );
  res.json({ ok: true, messages: rows });
});

app.get('/admin/download/:id', requireAdmin, async (req, res) => {
  const row = await db.get(`SELECT attachment_path FROM messages WHERE id = ?`, [
    req.params.id,
  ]);
  if (!row || !row.attachment_path) return res.status(404).send('Not found');
  const abs = path.join(DATA_DIR, row.attachment_path);
  if (!abs.startsWith(DATA_DIR)) return res.status(400).send('Bad path');
  if (!fs.existsSync(abs)) return res.status(404).send('Missing file');
  res.download(abs);
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Convenience routes for local navigation
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/about', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'about.html')));
app.get('/projects', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'projects.html')));
app.get('/cv', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'cv.html')));
app.get('/contact', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'contact.html')));
app.get('/admin', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

// 404 → home (local dev nicety)
app.use((_req, res) => res.redirect('/'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on http://127.0.0.1:${PORT}`);
  console.log(`   NODE_ENV=${NODE_ENV}`);
});