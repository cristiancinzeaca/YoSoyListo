// Inicio de sesión con Google por el método clásico (redirección + código), sin scripts de Google
// en nuestras páginas: así la CSP sigue siendo estricta.
const crypto = require('crypto');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

const isProduction = () => process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;

// Solo para probar en local sin Google: DEV_FAKE_GOOGLE=1 (nunca en producción).
const fakeMode = () => process.env.DEV_FAKE_GOOGLE === '1' && !isProduction();

function configured() {
  return fakeMode() || !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function authUrl(redirectUri, state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params}`;
}

function decodeJwtPayload(jwt) {
  const part = String(jwt).split('.')[1];
  if (!part) throw new Error('id_token mal formado');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

// El id_token llega directamente de Google por HTTPS (no a través del navegador),
// así que basta con comprobar emisor, destinatario y caducidad.
function identityFromIdToken(idToken, clientId, now = Date.now()) {
  const claims = decodeJwtPayload(idToken);
  if (!ISSUERS.includes(claims.iss)) throw new Error('Emisor no válido');
  if (claims.aud !== clientId) throw new Error('Destinatario no válido');
  if (!claims.exp || claims.exp * 1000 < now - 60_000) throw new Error('Token caducado');
  if (!claims.sub) throw new Error('Falta el identificador');
  return {
    sub: String(claims.sub),
    email: claims.email_verified === false ? null : claims.email || null,
    name: claims.name || null,
    givenName: claims.given_name || null,
  };
}

let exchangeOverride = null;

async function exchangeCode(code, redirectUri) {
  if (exchangeOverride) return exchangeOverride(code, redirectUri);
  if (fakeMode() && String(code).startsWith('dev:')) {
    const name = String(code).slice(4) || 'Probador';
    return { sub: `dev-${name.toLowerCase()}`, email: `${name.toLowerCase()}@example.com`, name, givenName: name };
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id_token) throw new Error(`Google rechazó el código (${res.status})`);
  return identityFromIdToken(data.id_token, process.env.GOOGLE_CLIENT_ID);
}

// Códigos de un solo uso (2 minutos) para terminar el inicio de sesión desde la página /entrar.
const pending = new Map();
const LOGIN_CODE_TTL_MS = 2 * 60_000;

function createLoginCode(identity, next = '/') {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
  const code = crypto.randomBytes(18).toString('base64url');
  pending.set(code, { identity, next, expires: now + LOGIN_CODE_TTL_MS });
  return code;
}

function consumeLoginCode(code) {
  const entry = typeof code === 'string' ? pending.get(code) : null;
  if (!entry) return null;
  pending.delete(code);
  return entry.expires >= Date.now() ? entry : null;
}

// Solo rutas internas (evita redirecciones a otros sitios).
function safeNext(next) {
  return typeof next === 'string' && /^\/(?!\/)[\w\-./?=&%]*$/.test(next) && next.length < 200 ? next : '/';
}

module.exports = {
  configured,
  fakeMode,
  authUrl,
  exchangeCode,
  identityFromIdToken,
  createLoginCode,
  consumeLoginCode,
  safeNext,
  setExchangeForTests: (fn) => (exchangeOverride = fn),
};
