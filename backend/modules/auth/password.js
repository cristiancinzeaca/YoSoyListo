// Contraseñas: scrypt con sal aleatoria (sin dependencias). Formato: scrypt$N$r$p$sal$hash
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || typeof password !== 'string') return false;
  const [algo, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const got = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

// Reglas mínimas: 8+ caracteres, no solo números, y que no sea de las típicas.
const COMMON = new Set(['12345678', '123456789', 'password', 'contraseña', 'qwertyui', 'yosoylisto', '11111111', 'abcdefgh']);
function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  if (password.length > 200) return 'La contraseña es demasiado larga';
  if (/^\d+$/.test(password)) return 'La contraseña no puede ser solo números';
  if (COMMON.has(password.toLowerCase())) return 'Esa contraseña es demasiado fácil de adivinar';
  return null;
}

module.exports = { hashPassword, verifyPassword, checkPassword };
