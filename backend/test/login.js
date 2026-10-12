// Ayuda para los tests: «entra con Google» sin Google (crea el código de acceso directamente).
const crypto = require('crypto');
const google = require('../modules/auth/google');

async function login(base, name, { guestToken, sub } = {}) {
  const code = google.createLoginCode({ sub: sub || `sub-${crypto.randomUUID()}`, email: null, name, givenName: name });
  const res = await fetch(`${base.startsWith('http') ? base : `http://${base}`}/api/auth/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, guestToken }),
  });
  const body = await res.json();
  if (res.status !== 200) throw new Error(`login ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

module.exports = { login };
