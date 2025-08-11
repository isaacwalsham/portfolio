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
const UPLOAD_DIR = path.join(ROOT, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- Multer (file upload) ----------
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
    cb(ok.includes(file.mimetype) ? null : new Error('Unsupported file type'), ok.includes(file.mimetype));
  },
}).single('attachment');

// ---------- App ----------
const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessions (MemoryStore is fine locally; restart clears sessions)
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 4 }, // 4 hours
}));

// Serve static site
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders(res, fp) {
    if (/\.(css|js|png|jpe?g|webp|svg|ico|pdf)$/i.test(fp)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

// ---------- Database ----------
let db;
(async () => {
  db = await open({ filename: path.join(ROOT, 'contact_messages.db'), driver: sqlite3.Database });
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

// ---------- Helpers ----------
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').toLowerCase());
const clamp = (s, m) => String(s ?? '').slice(0, m);
const esc = s => String(s ?? '')
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'", '&#39;');

function requireLogin(req, res, next) {
  if (req.session?.user) return next();
  const nextUrl = encodeURIComponent(req.originalUrl);
  return res.redirect('/admin/login?next=' + nextUrl);
}

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
        return res.json({ ok: true });
      }

      const name = clamp(req.body.name, 200).trim();
      const email = clamp(req.body.email, 200).trim();
      const subject = clamp(req.body.subject, 200).trim();
      const message = clamp(req.body.message, 5000).trim();

      if (!name || !email || !subject || !message) {
        if (req.file?.path) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ ok: false, error: 'All fields are required.' });
      }
      if (!isEmail(email)) {
        if (req.file?.path) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ ok: false, error: 'Invalid email address.' });
      }

      const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.socket.remoteAddress || '';
      const ua = req.headers['user-agent'] || '';
      const attachment = req.file ? path.relative(ROOT, req.file.path) : null;

      await db.run(
        `INSERT INTO messages (name, email, subject, message, ip, user_agent, attachment_path)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name, email, subject, message, ip, ua, attachment]
      );

      res.json({ ok: true, message: 'Saved' });
    } catch (e) {
      console.error('Contact error:', e);
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      res.status(500).json({ ok: false, error: 'Server error' });
    }
  });
});

// ---------- Admin: Login / Logout / Messages ----------
app.get('/admin/login', (_req, res) => {
  // If you're using admin.html as your login page:
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.post('/admin/login', (req, res) => {
  const user = String(req.body.username || '').trim();
  const pass = String(req.body.password || '');
  const envUser = (process.env.ADMIN_USER || 'admin').trim();
  const envPass = String(process.env.ADMIN_PASS || 'changeme');

  if (user === envUser && pass === envPass) {
    req.session.user = { name: user };
    const nextUrl = req.query.next && /^\/[a-z0-9/_-]*$/i.test(req.query.next)
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
    `SELECT id, name, email, subject, message, submitted_at, attachment_path
     FROM messages ORDER BY submitted_at DESC LIMIT 500`
  );

  const rowsHtml = rows.map(r => `
    <tr>
      <td>${r.id}</td>
      <td>${esc(r.submitted_at)}</td>
      <td>${esc(r.name)}</td>
      <td>${esc(r.email)}</td>
      <td>${esc(r.subject)}</td>
      <td style="max-width:420px;white-space:pre-wrap">${esc(r.message)}</td>
      <td>${r.attachment_path ? `<a href="/admin/file/${r.id}">Download</a>` : '—'}</td>
    </tr>
  `).join('');

  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'");
  res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Admin — Messages</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background:#0b1222; color:#e9eef8; margin:0; }
  header { padding:16px 20px; border-bottom:1px solid #23304d; display:flex; gap:12px; align-items:center; justify-content:space-between; }
  h1 { margin:0; font-size:20px; }
  form { margin:0; }
  button { background:#304ffe; color:#fff; border:0; padding:8px 12px; border-radius:8px; cursor:pointer; }
  .wrap { padding:20px; overflow:auto; }
  table { width:100%; border-collapse: collapse; }
  th, td { border-bottom:1px solid #23304d; padding:10px 8px; vertical-align: top; }
  th { text-align:left; color:#aab6d1; font-weight:600; position: sticky; top:0; background:#0b1222; }
  a { color:#7cc7ff; text-decoration:none; }
  a:hover { text-decoration:underline; }
</style>
</head>
<body>
<header>
  <h1>📨 Contact Messages (${rows.length})</h1>
  <form method="post" action="/admin/logout"><button type="submit">Log out</button></form>
</header>
<div class="wrap">
  <table>
    <thead>
      <tr>
        <th>ID</th><th>Date</th><th>Name</th><th>Email</th><th>Subject</th><th>Message</th><th>Attachment</th>
      </tr>
    </thead>
    <tbody>${rowsHtml || `<tr><td colspan="7">No messages yet.</td></tr>`}</tbody>
  </table>
</div>
</body>
</html>`);
});

app.get('/admin/file/:id', requireLogin, async (req, res) => {
  const row = await db.get(`SELECT attachment_path FROM messages WHERE id = ?`, [req.params.id]);
  if (!row || !row.attachment_path) return res.status(404).send('No attachment');
  const filePath = path.join(ROOT, row.attachment_path);
  if (!fs.existsSync(filePath)) return res.status(404).send('Missing file');
  return res.download(filePath);
});

// ---------- Public page routes (clean URLs) ----------
const send = (file) => (_req, res) => res.sendFile(path.join(PUBLIC_DIR, file));
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
app.listen(PORT, () => {
  console.log(`✅ http://localhost:${PORT}`);
  console.log(`🔐 Admin login at http://localhost:${PORT}/admin/login`);
});