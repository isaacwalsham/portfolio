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
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || ROOT;
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'contact_messages.db');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- Security / app ----------
const app = express();
app.set('trust proxy', 1); // required for secure cookies behind Render/Netlify proxy

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessions (MemoryStore is fine for your use-case; persistent store not required)
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 4, // 4 hours
      secure: process.env.NODE_ENV === 'production', // important for Render/HTTPS
    },
  })
);

// Serve static site (useful locally; Netlify serves /public in production)
app.use(
  express.static(PUBLIC_DIR, {
    extensions: ['html'],
    setHeaders(res, fp) {
      // Cache busting for HTML; long cache for assets
      if (/\.html$/i.test(fp)) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|pdf)$/i.test(fp)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  })
);

// ---------- Database ----------
let db;
(async () => {
  db = await open({ filename: DB_FILE, driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      attachment_path TEXT,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
})().catch(err => { console.error('DB init failed:', err); process.exit(1); });

// ---------- Uploads ----------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const ok = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    cb(ok.includes(file.mimetype) ? null : new Error('Unsupported file type'));
  },
});

// ---------- Helpers ----------
function requireLogin(req, res, next) {
  if (req.session?.user) return next();
  const nextUrl = encodeURIComponent(req.originalUrl);
  return res.redirect('/admin/login?next=' + nextUrl);
}

// ---------- Health (for Render/Netlify checks) ----------
app.get('/healthz', (_req, res) => res.send('ok'));

// ---------- API: Contact (rate-limited) ----------
app.use('/api/contact', rateLimit({ windowMs: 60_000, max: 10 }));

app.post('/api/contact', (req, res) => {
  upload(req, res, async (err) => {
    try {
      if (err) {
        if (req.file?.path) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ ok: false, error: err.message || 'Upload error' });
      }
      // Honeypot
      if ((req.body.company || '').trim() !== '') {
        if (req.file?.path) fs.unlink(req.file.path, () => {});
        return res.json({ ok: true, message: 'Thanks!' });
      }

      const name = (req.body.name || '').trim();
      const email = (req.body.email || '').trim();
      const subject = (req.body.subject || '').trim();
      const message = (req.body.message || '').trim();

      if (!name || !email || !message) {
        if (req.file?.path) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ ok: false, error: 'Missing required fields' });
      }

      const ip =
        (req.headers['x-forwarded-for'] || '')
          .toString()
          .split(',')[0]
          .trim() || req.socket.remoteAddress || '';
      const userAgent = req.headers['user-agent'] || '';

      let attachmentPath = null;
      if (req.file && req.file.path) {
        attachmentPath = path.relative(DATA_DIR, req.file.path);
      }

      await db.run(
        `INSERT INTO messages (name, email, subject, message, ip, user_agent, attachment_path)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name, email, subject, message, ip, userAgent, attachmentPath]
      );

      return res.json({ ok: true, message: 'Saved' });
    } catch (e) {
      console.error('Contact error:', e);
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      return res.status(500).json({ ok: false, error: 'Server error' });
    }
  });
});

// ---------- Admin (login, list, download, logout) ----------
app.get('/admin/login', (req, res) => {
  const nextUrl = req.query.next ? `?next=${encodeURIComponent(req.query.next)}` : '';
  const html = `
    <!doctype html>
    <html><head><meta charset="utf-8"><title>Admin Login</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;display:grid;place-items:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0}
      form{background:#111827;border:1px solid #1f2937;padding:24px;border-radius:12px;min-width:280px;box-shadow:0 10px 30px rgba(0,0,0,.3)}
      input{width:100%;padding:10px 12px;margin:8px 0;border-radius:8px;border:1px solid #374151;background:#0b1220;color:#e2e8f0}
      button{width:100%;padding:12px;border-radius:8px;border:none;background:#2563eb;color:white;font-weight:600;margin-top:8px;cursor:pointer}
      a{color:#93c5fd}
    </style></head>
    <body>
      <form method="POST" action="/admin/login${nextUrl}">
        <h2 style="margin:0 0 10px">Admin</h2>
        <input name="username" placeholder="Username" autofocus required />
        <input type="password" name="password" placeholder="Password" required />
        <button type="submit">Sign in</button>
        <p style="text-align:center;margin-top:10px;"><a href="/">← Back to site</a></p>
      </form>
    </body></html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.post('/admin/login', (req, res) => {
  const user = (req.body.username || '').toString();
  const pass = (req.body.password || '').toString();
  const ok = user === (process.env.ADMIN_USER || 'admin') && pass === (process.env.ADMIN_PASS || 'change-me');
  if (ok) {
    req.session.user = { name: user };
    const nextUrl = typeof req.query.next === 'string' && /^\/[A-Za-z0-9/_-]*$/.test(req.query.next)
      ? req.query.next
      : '/admin/messages';
    return res.redirect(nextUrl);
  }
  return res.status(401).send('Invalid credentials. <a href="/admin/login">Try again</a>');
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid', { path: '/' });
    res.redirect('/admin/login');
  });
});

app.get('/admin/messages', requireLogin, async (_req, res) => {
  const rows = await db.all(
    `SELECT id, submitted_at, name, email, subject, message, attachment_path
     FROM messages ORDER BY id DESC LIMIT 500`
  );
  res.json({ ok: true, messages: rows });
});

app.get('/admin/download/:id', requireLogin, async (req, res) => {
  const row = await db.get(`SELECT attachment_path FROM messages WHERE id = ?`, [req.params.id]);
  if (!row || !row.attachment_path) return res.status(404).send('Not found');

  const abs = path.join(DATA_DIR, row.attachment_path);
  // prevent path traversal
  if (!abs.startsWith(DATA_DIR)) return res.status(400).send('Bad path');
  if (!fs.existsSync(abs)) return res.status(404).send('Missing file');

  res.download(abs);
});

// ---------- Friendly routes for your static pages (optional for local) ----------
const send = file => (_req, res) => res.sendFile(path.join(PUBLIC_DIR, file));
app.get('/', send('index.html'));
app.get('/about', send('about.html'));
app.get('/projects', send('projects.html'));
app.get('/cv', send('cv.html'));
app.get('/contact', send('contact.html'));

// map /admin -> /admin/login (nice URL)
app.get('/admin', (_req, res) => res.redirect('/admin/login'));

// 404 -> home
app.use((_req, res) => res.redirect('/'));

// ---------- Start ----------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ http://localhost:${PORT}`);
  console.log(`🔐 Admin login at http://localhost:${PORT}/admin/login`);
});