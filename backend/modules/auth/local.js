// Cuentas con correo y contraseña: registro, confirmación del correo, entrar y recuperar la contraseña.
const crypto = require('crypto');
const { getDb, dbError } = require('../../core/db');
const { httpError } = require('../../core/http');
const players = require('../players/service');
const shop = require('../shop/service');
const { hashPassword, verifyPassword, checkPassword } = require('./password');
const mail = require('./mail');

const VERIFY_TTL_MS = 48 * 3600_000;
const RESET_TTL_MS = 3600_000;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function normEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e) || e.length > 254) throw httpError(400, 'Escribe un correo válido');
  return e;
}

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

// ---------- intentos fallidos (en memoria) ----------
const fails = new Map(); // email → { count, until }
function checkLock(email) {
  const f = fails.get(email);
  if (f && f.until > Date.now()) {
    const mins = Math.ceil((f.until - Date.now()) / 60_000);
    throw httpError(429, `Demasiados intentos. Vuelve a probar en ${mins} min o recupera tu contraseña.`);
  }
}
function failed(email) {
  const f = fails.get(email) || { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILS) {
    f.until = Date.now() + LOCK_MS;
    f.count = 0;
  }
  fails.set(email, f);
}

// ---------- envío de correos (como mucho uno por minuto y dirección) ----------
const lastMail = new Map();
function canMail(email, kind) {
  const key = `${kind}:${email}`;
  const t = lastMail.get(key) || 0;
  if (Date.now() - t < 60_000) return false;
  lastMail.set(key, Date.now());
  return true;
}

async function newToken(playerId, kind, ttl) {
  const token = crypto.randomBytes(32).toString('base64url');
  const { error } = await getDb()
    .from('auth_tokens')
    .insert({ token_hash: hashToken(token), player_id: playerId, kind, expires_at: new Date(Date.now() + ttl).toISOString() });
  if (error) throw dbError(error, 'auth.token');
  return token;
}

async function useToken(token, kind) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const db = getDb();
  const { data, error } = await db.from('auth_tokens').select('*').eq('token_hash', hashToken(token)).eq('kind', kind).maybeSingle();
  if (error) throw dbError(error, 'auth.token.load');
  if (!data || data.used_at) return null;
  const exp = data.expires_at instanceof Date ? data.expires_at.getTime() : Date.parse(data.expires_at);
  if (exp < Date.now()) return null;
  const { data: used, error: uErr } = await db
    .from('auth_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token_hash', data.token_hash)
    .is('used_at', null)
    .select('player_id');
  if (uErr) throw dbError(uErr, 'auth.token.use');
  return used.length ? data.player_id : null;
}

async function byEmail(email) {
  const { data, error } = await getDb()
    .from('players')
    .select('id, name, email, password_hash, email_verified, google_sub')
    .eq('email', email)
    .limit(5);
  if (error) throw dbError(error, 'auth.byEmail');
  return data;
}

const link = (base, kind, token) => `${base}/verificar#${kind}=${encodeURIComponent(token)}`;

async function sendVerify(row, base) {
  const token = await newToken(row.id, 'verify', VERIFY_TTL_MS);
  await mail.verifyMail(row.email, row.name, link(base, 'v', token));
}

// Crear cuenta.
async function register({ email, password, name } = {}, base) {
  const e = normEmail(email);
  const bad = checkPassword(password);
  if (bad) throw httpError(400, bad);
  const existing = await byEmail(e);
  if (existing.some((r) => r.password_hash)) throw httpError(409, 'Ya hay una cuenta con ese correo. Entra o recupera tu contraseña.');
  if (existing.some((r) => r.google_sub)) throw httpError(409, 'Ese correo ya tiene cuenta con Google: usa «Entrar con Google».');
  const wantedName = String(name || e.split('@')[0]).replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 20) || 'Jugador';
  const needsVerify = mail.configured();
  const id = await players.createLocal({ email: e, wantedName, passwordHash: await hashPassword(password), verified: !needsVerify });
  await shop.grantWelcome(id);
  if (needsVerify) {
    const row = (await byEmail(e)).find((r) => r.id === id);
    canMail(e, 'verify');
    try {
      await sendVerify(row, base);
    } catch (err) {
      console.error('[correo] verificación', err.message);
      throw httpError(502, 'Tu cuenta está creada, pero no hemos podido enviarte el correo. Prueba «Reenviar correo» en un rato.');
    }
    return { needsVerification: true, email: e };
  }
  const token = await players.createSession(id);
  return { player: await players.findById(id), token, created: true };
}

// Entrar.
async function login({ email, password } = {}) {
  const e = normEmail(email);
  checkLock(e);
  const row = (await byEmail(e)).find((r) => r.password_hash);
  const ok = row ? await verifyPassword(String(password || ''), row.password_hash) : false;
  if (!ok) {
    failed(e);
    const google = !row && (await byEmail(e)).some((r) => r.google_sub);
    throw httpError(401, google ? 'Esa cuenta se creó con Google: usa «Entrar con Google».' : 'Correo o contraseña incorrectos');
  }
  fails.delete(e);
  if (!row.email_verified && mail.configured()) {
    const err = httpError(403, 'Confirma tu correo: te enviamos un enlace al crear la cuenta.');
    err.code = 'unverified';
    throw err;
  }
  const token = await players.createSession(row.id);
  return { player: await players.findById(row.id), token, created: false };
}

// Confirmar el correo (desde el enlace).
async function verify(token) {
  const playerId = await useToken(token, 'verify');
  if (!playerId) throw httpError(400, 'El enlace no es válido o ha caducado. Pide uno nuevo desde «Entrar».');
  const { error } = await getDb().from('players').update({ email_verified: true }).eq('id', playerId).select('id');
  if (error) throw dbError(error, 'auth.verify');
  const session = await players.createSession(playerId);
  return { player: await players.findById(playerId), token: session, created: true };
}

// Reenviar la confirmación (siempre responde lo mismo, para no revelar qué correos existen).
async function resend({ email } = {}, base) {
  const e = normEmail(email);
  const row = (await byEmail(e)).find((r) => r.password_hash && !r.email_verified);
  if (row && canMail(e, 'verify')) await sendVerify(row, base).catch((err) => console.error('[correo] reenviar', err.message));
  return { ok: true };
}

// He olvidado la contraseña.
async function forgot({ email } = {}, base) {
  const e = normEmail(email);
  const row = (await byEmail(e)).find((r) => r.password_hash);
  if (row && canMail(e, 'reset')) {
    const token = await newToken(row.id, 'reset', RESET_TTL_MS);
    await mail.resetMail(row.email, row.name, link(base, 'r', token)).catch((err) => console.error('[correo] reset', err.message));
  }
  return { ok: true };
}

// Nueva contraseña (desde el enlace). Cierra las demás sesiones.
async function reset({ token, password } = {}) {
  const bad = checkPassword(password);
  if (bad) throw httpError(400, bad);
  const playerId = await useToken(token, 'reset');
  if (!playerId) throw httpError(400, 'El enlace no es válido o ha caducado. Pide uno nuevo.');
  const db = getDb();
  const { error } = await db
    .from('players')
    .update({ password_hash: await hashPassword(password), email_verified: true })
    .eq('id', playerId)
    .select('id');
  if (error) throw dbError(error, 'auth.reset');
  await db.from('player_sessions').delete().eq('player_id', playerId);
  const session = await players.createSession(playerId);
  return { player: await players.findById(playerId), token: session, created: false };
}

function resetMemory() {
  fails.clear();
  lastMail.clear();
}

module.exports = { register, login, verify, resend, forgot, reset, normEmail, resetMemory };
