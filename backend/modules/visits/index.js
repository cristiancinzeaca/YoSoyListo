// Visitas a la web, sin cookies ni datos personales: por día, origen y página.
// Los «únicos» se cuentan con una huella de un solo día (IP + navegador + sal), que vive
// solo en memoria y se tira a medianoche; a la base de datos llegan únicamente los totales.
const crypto = require('crypto');
const { getDb } = require('../../core/db');

const FLUSH_MS = 60_000;
const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp\/|telegrambot|discordbot|headless|lighthouse|pingdom|uptime|curl|wget|python|node-fetch|axios|go-http/i;
const SKIP = /^\/(api|auth|ws|admin|health|img|js|fonts|map|\.well-known)(\/|$)/;

// De dónde viene: ?utm_source=… (o ?ref=…) manda; si no, la web que le ha traído.
const HOSTS = [
  [/tiktok|musical\.ly|bytedance/, 'tiktok'],
  [/(^|\.)google\./, 'google'],
  [/bing\.com|duckduckgo|yahoo|ecosia|qwant/, 'buscadores'],
  [/instagram/, 'instagram'],
  [/facebook|fb\.com|fb\.me/, 'facebook'],
  [/whatsapp|wa\.me/, 'whatsapp'],
  [/(^|\.)t\.co$|twitter|x\.com/, 'x'],
  [/reddit/, 'reddit'],
  [/youtube|youtu\.be/, 'youtube'],
  [/crazygames/, 'crazygames'],
  [/android-app:\/\/es\.yosoylisto|^es\.yosoylisto\.app/, 'android'],
];

function sourceOf(req) {
  const tag = String(req.query.utm_source || req.query.ref || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
  if (tag) return tag;
  const ref = req.get('referer') || '';
  if (!ref) return 'directo';
  let host = ref;
  try {
    host = new URL(ref).hostname.toLowerCase();
  } catch {
    // referer raro (android-app://…): se mira tal cual
  }
  if (host && host === (req.hostname || '').toLowerCase()) return 'interno';
  if (/yosoylisto/.test(host) && !/android/.test(ref)) return 'interno';
  for (const [re, name] of HOSTS) if (re.test(host) || re.test(ref)) return name;
  return 'otros';
}

function pageOf(path) {
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path.slice(0, 60) || '/';
}

function createVisits({ flushMs = FLUSH_MS } = {}) {
  let buffer = new Map();
  let day = null;
  let seen = new Set();
  let salt = crypto.randomBytes(16);

  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });

  function record(req) {
    const d = today();
    if (d !== day) {
      day = d;
      seen = new Set();
      salt = crypto.randomBytes(16);
    }
    const source = sourceOf(req);
    const page = pageOf(req.path);
    const print = crypto.createHash('sha256').update(salt).update(req.ip || '').update(req.get('user-agent') || '').digest('base64').slice(0, 16);
    const unique = !seen.has(print);
    if (unique) seen.add(print);
    const key = `${d}|${source}|${page}`;
    const row = buffer.get(key) || { day: d, source, page, views: 0, uniques: 0 };
    row.views++;
    if (unique) row.uniques++;
    buffer.set(key, row);
  }

  function middleware(req, res, next) {
    if (req.method !== 'GET' || SKIP.test(req.path) || /\.[a-z0-9]{2,5}$/i.test(req.path)) return next();
    if (!/text\/html/.test(req.get('accept') || '') || BOTS.test(req.get('user-agent') || '')) return next();
    if (req.get('purpose') === 'prefetch' || req.get('sec-purpose')) return next();
    res.on('finish', () => {
      if (res.statusCode === 200) {
        try {
          record(req);
        } catch (err) {
          console.error('[visitas]', err.message);
        }
      }
    });
    next();
  }

  async function flush() {
    if (!buffer.size) return;
    const rows = [...buffer.values()];
    buffer = new Map();
    const { error } = await getDb().rpc('count_visits', { p_rows: rows });
    if (error) console.error('[visitas] guardar', error.message);
  }

  const timer = setInterval(() => flush().catch((e) => console.error('[visitas]', e.message)), flushMs);
  timer.unref();

  return { middleware, flush, close: () => clearInterval(timer), _peek: () => [...buffer.values()] };
}

module.exports = { createVisits, sourceOf };
