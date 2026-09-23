const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
const CONTENT_FILE = path.join(ROOT, 'content.json');
const MESSAGES_FILE = path.join(ROOT, 'messages.json');

const FACILITY_IMAGES = {
  strength:            { file: 'gym-sequence/ezgif-frame-062.jpg', label: 'STRENGTH TRAINING' },
  free_weights:        { file: 'gym-sequence/ezgif-frame-091.jpg', label: 'FREE WEIGHTS' },
  cardio:              { file: 'gym-sequence/ezgif-frame-031.jpg', label: 'CARDIO' },
  functional_training: { file: 'gym-sequence/ezgif-frame-181.jpg', label: 'FUNCTIONAL TRAINING' },
  training_environment:{ file: 'gym-sequence/ezgif-frame-211.jpg', label: 'TRAINING ENVIRONMENT' },
};
const BACKUP_DIR = path.join(ROOT, '.backup', 'frames');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

const sessions = new Set();

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function isJpeg(buf) { return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff; }
function parseJsonBuffer(buf) {
  let t = buf.toString('utf8');
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  return JSON.parse(t);
}
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    req.on('data', c => { total += c.length; if (total > max) { reject(new Error('Body too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function cookieValue(req, name) {
  const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]*)').exec(req.headers.cookie || '');
  return m ? decodeURIComponent(m[1]) : null;
}
function isAuthed(req) {
  const t = cookieValue(req, 'oc_admin');
  return !!t && sessions.has(t);
}
function convertToJpeg(inputPath, outputPath) {
  const script = [
    'Add-Type -AssemblyName System.Drawing',
    `$src = "${inputPath}"`, `$dst = "${outputPath}"`,
    '$img = [System.Drawing.Image]::FromFile($src)',
    '$bmp = New-Object System.Drawing.Bitmap $img.Width, $img.Height',
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.Clear([System.Drawing.Color]::Black)',
    '$g.DrawImage($img, 0, 0, $img.Width, $img.Height)',
    '$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }',
    '$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)',
    '$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]90)',
    '$bmp.Save($dst, $enc, $ep)', '$g.Dispose(); $bmp.Dispose(); $img.Dispose()',
  ].join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeout: 60000 });
}

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

  if (urlPath === '/admin' || urlPath === '/admin/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(path.join(ROOT, 'admin.html')).pipe(res);
  }

  if (urlPath === '/api/login' && req.method === 'POST') {
    let b; try { b = parseJsonBuffer(await readBody(req, 1024 * 1024)); } catch { return json(res, 400, { ok: false, error: 'Bad request' }); }
    if (b.password === ADMIN_PASSWORD) {
      const token = crypto.randomBytes(24).toString('hex');
      sessions.add(token);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'Set-Cookie': `oc_admin=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
      });
      return res.end(JSON.stringify({ ok: true }));
    }
    return json(res, 401, { ok: false, error: 'Wrong password' });
  }

  if (urlPath === '/api/logout' && req.method === 'POST') {
    const t = cookieValue(req, 'oc_admin'); if (t) sessions.delete(t);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': 'oc_admin=; Path=/; Max-Age=0' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (urlPath === '/api/session') return json(res, 200, { ok: isAuthed(req) });

  if (urlPath === '/api/facilities') {
    const list = Object.entries(FACILITY_IMAGES).map(([key, v]) => {
      const full = path.join(ROOT, v.file);
      let size = 0, updated = null, original = true;
      if (fs.existsSync(full)) {
        const st = fs.statSync(full);
        size = st.size; updated = st.mtime.toISOString();
        const bak = path.join(BACKUP_DIR, path.basename(v.file));
        if (fs.existsSync(bak)) original = fs.readFileSync(full).compare(fs.readFileSync(bak)) === 0;
      }
      return { key, label: v.label, file: v.file, size, updated, original };
    });
    return json(res, 200, { ok: true, facilities: list });
  }

  if (urlPath === '/api/upload' && req.method === 'POST') {
    if (!isAuthed(req)) return json(res, 401, { ok: false, error: 'Not authorised' });
    let p; try { p = parseJsonBuffer(await readBody(req, MAX_UPLOAD_BYTES)); } catch { return json(res, 400, { ok: false, error: 'Bad request' }); }
    const entry = FACILITY_IMAGES[p.key];
    if (!entry) return json(res, 400, { ok: false, error: 'Unknown image key' });
    if (!p.data || typeof p.data !== 'string') return json(res, 400, { ok: false, error: 'No image data' });
    let buf; try { buf = Buffer.from(p.data, 'base64'); } catch { return json(res, 400, { ok: false, error: 'Invalid image data' }); }
    if (buf.length < 16) return json(res, 400, { ok: false, error: 'Image too small' });
    const jpegSafe = isJpeg(buf) || /^image\/jpe?g/i.test(p.type || '') || /\.jpe?g$/i.test(p.name || '');
    let out = buf;
    if (!jpegSafe) {
      const tmp = path.join(ROOT, '.admin-tmp');
      fs.mkdirSync(tmp, { recursive: true });
      const ip = path.join(tmp, crypto.randomBytes(8).toString('hex') + '.img');
      const op = path.join(tmp, crypto.randomBytes(8).toString('hex') + '.jpg');
      try { fs.writeFileSync(ip, buf); convertToJpeg(ip, op); out = fs.readFileSync(op); }
      catch { out = buf; }
      finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
    }
    fs.writeFileSync(path.join(ROOT, entry.file), out);
    return json(res, 200, { ok: true, file: entry.file, bytes: out.length });
  }

  if (urlPath === '/api/reset' && req.method === 'POST') {
    if (!isAuthed(req)) return json(res, 401, { ok: false, error: 'Not authorised' });
    let p; try { p = parseJsonBuffer(await readBody(req, 1024 * 1024)); } catch { return json(res, 400, { ok: false, error: 'Bad request' }); }
    const entry = FACILITY_IMAGES[p.key];
    if (!entry) return json(res, 400, { ok: false, error: 'Unknown image key' });
    const bak = path.join(BACKUP_DIR, path.basename(entry.file));
    if (!fs.existsSync(bak)) return json(res, 404, { ok: false, error: 'No backup found' });
    fs.copyFileSync(bak, path.join(ROOT, entry.file));
    return json(res, 200, { ok: true, file: entry.file });
  }

  if (urlPath === '/api/content' && req.method === 'GET') {
    if (!isAuthed(req)) return json(res, 401, { ok: false, error: 'Not authorised' });
    try { return json(res, 200, { ok: true, content: parseJsonBuffer(fs.readFileSync(CONTENT_FILE)) }); }
    catch { return json(res, 500, { ok: false, error: 'content.json unreadable' }); }
  }

  if (urlPath === '/api/content' && req.method === 'POST') {
    if (!isAuthed(req)) return json(res, 401, { ok: false, error: 'Not authorised' });
    let p; try { p = parseJsonBuffer(await readBody(req, 2 * 1024 * 1024)); } catch { return json(res, 400, { ok: false, error: 'Bad request' }); }
    const c = p.content;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return json(res, 400, { ok: false, error: 'Invalid content object' });
    if (!Array.isArray(c.pricing) || !Array.isArray(c.faqs) || !Array.isArray(c.programs) || !Array.isArray(c.trainers)) {
      return json(res, 400, { ok: false, error: 'Missing required lists (pricing, faqs, programs, trainers)' });
    }
    fs.writeFileSync(CONTENT_FILE, JSON.stringify(c, null, 2));
    return json(res, 200, { ok: true });
  }

  if (urlPath === '/api/messages' && req.method === 'POST') {
    let p; try { p = parseJsonBuffer(await readBody(req, 64 * 1024)); } catch { return json(res, 400, { ok: false, error: 'Bad request' }); }
    const name = String(p.name || '').trim().slice(0, 100);
    const phone = String(p.phone || '').trim().slice(0, 20);
    const message = String(p.message || '').trim().slice(0, 2000);
    if (name.length < 2 || message.length < 5) return json(res, 400, { ok: false, error: 'Please enter your name and a message (min 5 chars).' });
    let msgs = [];
    try { msgs = parseJsonBuffer(fs.readFileSync(MESSAGES_FILE)); if (!Array.isArray(msgs)) msgs = []; } catch {}
    msgs.push({ id: Date.now(), name, phone, message, at: new Date().toISOString(), read: false });
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(msgs, null, 2));
    return json(res, 200, { ok: true });
  }

  if (urlPath === '/api/messages' && req.method === 'GET') {
    if (!isAuthed(req)) return json(res, 401, { ok: false, error: 'Not authorised' });
    let msgs = [];
    try { msgs = parseJsonBuffer(fs.readFileSync(MESSAGES_FILE)); if (!Array.isArray(msgs)) msgs = []; } catch {}
    return json(res, 200, { ok: true, messages: msgs });
  }

  if (urlPath === '/api/messages/read' && req.method === 'POST') {
    if (!isAuthed(req)) return json(res, 401, { ok: false, error: 'Not authorised' });
    let p; try { p = parseJsonBuffer(await readBody(req, 8192)); } catch { return json(res, 400, { ok: false, error: 'Bad request' }); }
    let msgs = [];
    try { msgs = parseJsonBuffer(fs.readFileSync(MESSAGES_FILE)); if (!Array.isArray(msgs)) msgs = []; } catch {}
    msgs = msgs.map(m => (m.id === p.id ? { ...m, read: true } : m));
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(msgs, null, 2));
    return json(res, 200, { ok: true });
  }

  let filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
  if (!fs.existsSync(filePath)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Serving Oxygen Fitness Club at http://localhost:${PORT}`);
  console.log(`Admin panel at http://localhost:${PORT}/admin`);
});