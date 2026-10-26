'use strict';
/* Sisonke server - zero dependencies. Run: node index.js */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = Number(process.env.SERVER_PORT) || Number(process.env.PORT) || 3000;
const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUB = path.join(__dirname, 'public');
const DEMO = 'demo@sisonke.app', DEMO_PW = 'Demo@2026';
const FREE_LIMIT = 50, MAX_USERS = 2000, VAT = 0.15;

fs.mkdirSync(DIR, { recursive: true });
const FILE = path.join(DIR, 'db.json');
let db = { users: {}, data: {}, shares: {} };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* first run */ }
db.users = db.users || {}; db.data = db.data || {}; db.shares = db.shares || {};
function persist() { const t = FILE + '.tmp'; fs.writeFileSync(t, JSON.stringify(db)); fs.renameSync(t, FILE); }

/* ---------- helpers ---------- */
const scrypt = (p, s) => new Promise((res, rej) => crypto.scrypt(p, s, 64, (e, k) => e ? rej(e) : res(k)));
async function hashPw(pw) { const s = crypto.randomBytes(16); const k = await scrypt(pw, s); return s.toString('hex') + ':' + k.toString('hex'); }
async function checkPw(pw, stored) {
  const [s, h] = String(stored).split(':'); const k = await scrypt(pw, Buffer.from(s, 'hex')); const hb = Buffer.from(h, 'hex');
  return hb.length === k.length && crypto.timingSafeEqual(hb, k);
}
const rid = () => crypto.randomBytes(6).toString('hex');
const clean = (s, max) => String(s == null ? '' : s).replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max || 80);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => 'R' + Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = n => Math.round(n * 100) / 100;
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 80;

function ud(email) { return db.data[email] || (db.data[email] = { items: [], quotes: [], audit: [] }); }
function log(email, a) { const d = ud(email); d.audit.unshift({ t: Date.now(), a }); d.audit.length = Math.min(d.audit.length, 100); }

/* sessions (in memory) */
const sessions = new Map();
const SESSION_MS = 8 * 3600 * 1000;
function getCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  return m ? m.slice(name.length + 1) : '';
}
function session(req) {
  const sid = getCookie(req, 'sid'); const s = sessions.get(sid);
  if (!s) return null; if (s.exp < Date.now()) { sessions.delete(sid); return null; } return s;
}
const isHttps = req => req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted;
function setSession(req, res, email) {
  const sid = crypto.randomBytes(32).toString('hex'); sessions.set(sid, { email, exp: Date.now() + SESSION_MS });
  res.setHeader('Set-Cookie', 'sid=' + sid + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + (SESSION_MS / 1000) + (isHttps(req) ? '; Secure' : ''));
}

/* rate limiting: failed logins/registrations */
const hits = new Map();
function tooMany(key, max) { const h = hits.get(key); return !!(h && h.reset > Date.now() && h.n >= max); }
function addHit(key) { const h = hits.get(key); if (!h || h.reset < Date.now()) hits.set(key, { n: 1, reset: Date.now() + 15 * 60000 }); else h.n++; }
setInterval(() => { const n = Date.now(); hits.forEach((v, k) => { if (v.reset < n) hits.delete(k); }); sessions.forEach((v, k) => { if (v.exp < n) sessions.delete(k); }); }, 60000).unref();
const ipOf = req => (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'x');

/* fraud / duplicate flags (computed on the server) */
function flagsFor(it, list) {
  const f = []; let sum = 0, n = 0;
  list.forEach(o => { if (o !== it && o.type === it.type) { sum += o.amount; n++; } });
  if (n >= 3 && it.amount > 5 * (sum / n)) f.push('unusual amount');
  if (list.some(o => o !== it && o.type === it.type && o.amount === it.amount && o.note === it.note && Math.abs(o.t - it.t) < 600000)) f.push('possible duplicate');
  return f;
}

/* ---------- demo data (reset on every start so it is always fresh) ---------- */
async function seedDemo() {
  db.users[DEMO] = { pw: await hashPw(DEMO_PW), created: Date.now() };
  const now = Date.now(), D = 864e5; const items = [];
  const add = (type, amount, note, days, extra) => items.push({ id: rid(), type, amount, note, t: now - days * D + (extra || 0) });
  add('sale', 650, 'Custom cake - Thandi', 1); add('sale', 480, 'Cupcakes x24', 2);
  add('sale', 850, 'Birthday cake order', 3); add('sale', 850, 'Birthday cake order', 3, 90000);
  add('sale', 720, 'Scones for church event', 4); add('sale', 260, 'Muffins x12', 5);
  add('sale', 1200, 'Wedding tasting boxes', 6); add('sale', 480, 'Cupcakes x24', 8);
  add('sale', 700, 'Custom cake - Lerato', 9); add('sale', 320, 'Bread rolls x40', 11);
  add('sale', 9500, 'Bulk order - unverified', 0.2);
  add('expense', 540, 'Flour and sugar', 2); add('expense', 410, 'Butter and eggs', 5);
  add('expense', 180, 'Packaging boxes', 7); add('expense', 150, 'Gas', 9);
  add('expense', 120, 'Transport to market', 10); add('expense', 600, 'Ingredients restock', 12);
  items.sort((a, b) => b.t - a.t);
  db.data[DEMO] = { items, quotes: [{ id: rid(), c: 'Mrs Dlamini', d: 'Wedding cake (3-tier)', q: 1, p: 2800, t: now - 2 * 3600000 }], audit: [] };
  log(DEMO, 'Demo data loaded');
  persist();
}

/* ---------- http plumbing ---------- */
function secHeaders(res, req) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
}
function send(res, code, body, type) { res.statusCode = code; res.setHeader('Content-Type', type || 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(body); }
const json = (res, code, obj) => send(res, code, JSON.stringify(obj));
const fail = (res, code, msg) => json(res, code, { error: msg });
function readBody(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) return reject(new Error('Content-Type must be application/json'));
    let n = 0; const ch = [];
    req.on('data', c => { n += c.length; if (n > 10000) { reject(new Error('Request too large')); req.destroy(); } else ch.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(ch).toString() || '{}')); } catch (e) { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'application/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/print.js': ['print.js', 'application/javascript; charset=utf-8'] };

function quotePage(q) {
  const tot = r2(q.q * q.p), vat = r2(tot * VAT);
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Quote - ' + esc(q.c) + '</title><link rel="stylesheet" href="/style.css"></head><body><main>' +
    '<div class="card"><h1>Quote</h1><p class="mut">Prepared with Sisonke on ' + esc(new Date(q.t).toLocaleDateString('en-ZA')) + '</p>' +
    '<p><b>Customer:</b> ' + esc(q.c) + '</p><div class="item"><div>' + esc(q.q + ' x ' + q.d) + '</div><div>' + money(q.p) + ' each</div></div>' +
    '<div class="item"><div>Subtotal</div><div>' + money(tot) + '</div></div><div class="item"><div>VAT 15%</div><div>' + money(vat) + '</div></div>' +
    '<div class="item"><b>Total</b><b>' + money(tot + vat) + '</b></div><p class="mut">Prices are estimates and valid for 14 days.</p>' +
    '<button id="p" class="noprint">Print or save as PDF</button></div></main><script src="/print.js"></script></body></html>';
}

async function handler(req, res) {
  secHeaders(res, req);
  const url = new URL(req.url, 'http://x'); const p = url.pathname; const m = req.method;

  if (m === 'GET' && STATIC[p]) {
    return fs.readFile(path.join(PUB, STATIC[p][0]), (e, b) => { if (e) return send(res, 404, 'Not found', 'text/plain'); res.setHeader('Cache-Control', 'no-cache'); res.statusCode = 200; res.setHeader('Content-Type', STATIC[p][1]); res.end(b); });
  }
  if (m === 'GET' && p === '/api/health') return json(res, 200, { ok: true });
  let qm = p.match(/^\/q\/([0-9a-f]{32})$/);
  if (m === 'GET' && qm) {
    const sh = db.shares[qm[1]]; const q = sh && ud(sh.email).quotes.find(x => x.id === sh.qid);
    return q ? send(res, 200, quotePage(q), 'text/html; charset=utf-8') : send(res, 404, 'Quote not found', 'text/plain');
  }
  if (!p.startsWith('/api/')) return send(res, 404, 'Not found', 'text/plain');

  /* CSRF defence: SameSite=Strict cookie + same-origin check on changes */
  if (m !== 'GET') {
    const o = req.headers.origin;
    if (o) { let h = ''; try { h = new URL(o).host; } catch (e) { /* bad origin */ } if (h !== req.headers.host) return fail(res, 403, 'Cross-site request blocked'); }
  }
  try {
    if (m === 'POST' && (p === '/api/login' || p === '/api/register')) {
      const b = await readBody(req); const email = clean(b.email, 80).toLowerCase(), pw = String(b.password || '');
      const ip = ipOf(req);
      if (tooMany('ip:' + ip, 15) || tooMany('em:' + email, 5)) return fail(res, 429, 'Too many attempts. Try again in 15 minutes.');
      if (!emailOk(email)) return fail(res, 400, 'Enter a valid email.');
      if (pw.length < 8 || pw.length > 64) return fail(res, 400, 'Password must be 8 to 64 characters.');
      if (p === '/api/register') {
        if (b.consent !== true) return fail(res, 400, 'Please accept the privacy consent first.');
        if (db.users[email]) { addHit('ip:' + ip); return fail(res, 409, 'That account already exists.'); }
        if (Object.keys(db.users).length >= MAX_USERS) return fail(res, 503, 'Sign-ups are full for now.');
        db.users[email] = { pw: await hashPw(pw), created: Date.now() }; log(email, 'Account created'); persist();
      } else {
        const u = db.users[email];
        if (!u || !(await checkPw(pw, u.pw))) { addHit('ip:' + ip); addHit('em:' + email); return fail(res, 401, 'Wrong email or password.'); }
        hits.delete('em:' + email); log(email, 'Logged in'); persist();
      }
      setSession(req, res, email); return json(res, 200, { email });
    }
    const s = session(req);
    if (!s) return fail(res, 401, 'Please log in.');
    const email = s.email, d = ud(email);

    if (m === 'GET' && p === '/api/me') return json(res, 200, { email });
    if (m === 'POST' && p === '/api/logout') { sessions.delete(getCookie(req, 'sid')); res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res, 200, { ok: true }); }

    if (m === 'GET' && p === '/api/data') {
      const used = d.items.filter(x => x.t > Date.now() - 30 * 864e5).length;
      return json(res, 200, { items: d.items.map(x => Object.assign({}, x, { flags: flagsFor(x, d.items) })), quotes: d.quotes.map(q => ({ id: q.id, c: q.c, d: q.d, q: q.q, p: q.p, t: q.t, shared: !!q.share })), audit: d.audit.slice(0, 15), used, limit: FREE_LIMIT });
    }
    if (m === 'POST' && p === '/api/items') {
      const b = await readBody(req); const amount = r2(Number(b.amount)), note = clean(b.note, 60);
      if (b.type !== 'sale' && b.type !== 'expense') return fail(res, 400, 'Type must be sale or expense.');
      if (!(amount >= 0.01 && amount <= 1e7)) return fail(res, 400, 'Enter an amount between R0.01 and R10 000 000.');
      if (!note) return fail(res, 400, 'Add a short note.');
      if (d.items.filter(x => x.t > Date.now() - 30 * 864e5).length >= FREE_LIMIT) return fail(res, 402, 'Free plan limit reached (50 entries per 30 days). Upgrade to Pro for unlimited records.');
      d.items.unshift({ id: rid(), type: b.type, amount, note, t: Date.now() }); log(email, 'Added ' + b.type + ' ' + money(amount)); persist(); return json(res, 200, { ok: true });
    }
    let im = p.match(/^\/api\/items\/([0-9a-f]{12})$/);
    if (m === 'DELETE' && im) {
      const i = d.items.findIndex(x => x.id === im[1]); if (i < 0) return fail(res, 404, 'Entry not found.');
      const x = d.items.splice(i, 1)[0]; log(email, 'Removed ' + x.type + ' ' + money(x.amount)); persist(); return json(res, 200, { ok: true });
    }
    if (m === 'POST' && p === '/api/quotes') {
      const b = await readBody(req); const c = clean(b.customer, 50), it = clean(b.item, 60), q = parseInt(b.qty, 10), pr = r2(Number(b.price));
      if (!c || !it || !(q >= 1 && q <= 10000) || !(pr >= 0.01 && pr <= 1e6)) return fail(res, 400, 'Fill in every field with valid values.');
      d.quotes.unshift({ id: rid(), c, d: it, q, p: pr, t: Date.now() }); log(email, 'Created quote for ' + c); persist(); return json(res, 200, { ok: true });
    }
    let qs = p.match(/^\/api\/quotes\/([0-9a-f]{12})\/(share|sale)$/);
    if (m === 'POST' && qs) {
      const q = d.quotes.find(x => x.id === qs[1]); if (!q) return fail(res, 404, 'Quote not found.');
      if (qs[2] === 'share') {
        if (!q.share) { q.share = crypto.randomBytes(16).toString('hex'); db.shares[q.share] = { email, qid: q.id }; log(email, 'Shared quote for ' + q.c); persist(); }
        return json(res, 200, { url: '/q/' + q.share });
      }
      const tot = r2(q.q * q.p); d.items.unshift({ id: rid(), type: 'sale', amount: tot, note: 'Quote: ' + q.d, t: Date.now() }); log(email, 'Recorded quote as sale ' + money(tot)); persist(); return json(res, 200, { ok: true });
    }
    if (m === 'GET' && p === '/api/export') {
      log(email, 'Exported data'); persist();
      res.setHeader('Content-Disposition', 'attachment; filename="sisonke-my-data.json"');
      return json(res, 200, { account: email, exported: new Date().toISOString(), items: d.items, quotes: d.quotes.map(q => ({ c: q.c, d: q.d, q: q.q, p: q.p, t: q.t })), audit: d.audit });
    }
    if (m === 'DELETE' && p === '/api/data') {
      d.quotes.forEach(q => { if (q.share) delete db.shares[q.share]; });
      db.data[email] = { items: [], quotes: [], audit: [] }; log(email, 'Deleted all records'); persist(); return json(res, 200, { ok: true });
    }
    if (m === 'DELETE' && p === '/api/account') {
      if (email === DEMO) return fail(res, 403, 'The demo account cannot be deleted.');
      d.quotes.forEach(q => { if (q.share) delete db.shares[q.share]; });
      delete db.users[email]; delete db.data[email]; sessions.delete(getCookie(req, 'sid')); persist();
      res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res, 200, { ok: true });
    }
    return fail(res, 404, 'Not found');
  } catch (e) {
    if (res.headersSent) return;
    return fail(res, /JSON|large|Content-Type/.test(e.message) ? 400 : 500, /JSON|large|Content-Type/.test(e.message) ? e.message : 'Server error');
  }
}

seedDemo().then(() => {
  http.createServer((req, res) => { handler(req, res).catch(() => { try { fail(res, 500, 'Server error'); } catch (e) { /* ignore */ } }); })
    .listen(PORT, '0.0.0.0', () => console.log('Sisonke running on port ' + PORT + '  |  demo: ' + DEMO + ' / ' + DEMO_PW));
});
process.on('uncaughtException', e => console.error('Error:', e.message));
