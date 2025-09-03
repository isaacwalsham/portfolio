const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (/\.(css|js|png|jpe?g|gif|svg|ico|pdf|webp)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

const send = (file) => (_req, res) => res.sendFile(path.join(PUBLIC_DIR, file));
app.get('/', send('index.html'));
app.get('/index.html', send('index.html'));
app.get('/about', send('about.html'));
app.get('/projects', send('projects.html'));
app.get('/cv', send('cv.html'));
app.get('/contact', send('contact.html'));
app.get('/admin', send('admin.html'));

app.post('/success.html', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'success.html'));
});

app.get('/healthz', (_req, res) => res.send('ok'));

app.use((_req, res) => res.redirect('/'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Local server running →  http://127.0.0.1:${PORT}/`);
});