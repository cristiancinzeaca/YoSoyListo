const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../core/server');
const { setDbForTests } = require('../core/db');
const { createFakeDb } = require('./fakeDb');
const { login } = require('./login');
const mail = require('../modules/auth/mail');
const local = require('../modules/auth/local');
const { hashPassword, verifyPassword, checkPassword } = require('../modules/auth/password');

let server;
let base;
let db;
const sent = [];

test.before(async () => {
  db = createFakeDb();
  setDbForTests(db);
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  // Correo simulado: guardamos los enlaces.
  mail.verifyMail = async (to, name, url) => sent.push({ kind: 'verify', to, url });
  mail.resetMail = async (to, name, url) => sent.push({ kind: 'reset', to, url });
});

test.after(() => server.close());
test.beforeEach(() => local.resetMemory());

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const tokenFrom = (url) => decodeURIComponent(url.split('=')[1]);

test('contraseñas: hash y reglas', async () => {
  const h = await hashPassword('secreto-largo');
  assert.ok(h.startsWith('scrypt$'));
  assert.equal(await verifyPassword('secreto-largo', h), true);
  assert.equal(await verifyPassword('otra-cosa', h), false);
  assert.ok(checkPassword('1234'));
  assert.ok(checkPassword('12345678901'));
  assert.equal(checkPassword('mi gato Bigotes'), null);
});

test('sin servicio de correo: registro directo y entrar', async () => {
  mail.configured = () => false;
  const r = await call('POST', '/api/auth/register', { email: 'Ana@Correo.es', password: 'gatitos-2026', name: 'Anita' });
  assert.equal(r.status, 201);
  assert.ok(r.body.token);
  assert.equal(r.body.player.name, 'Anita');
  assert.equal(r.body.player.hasAccount, true);
  assert.equal(r.body.player.coins, 100);
  assert.equal(r.body.player.password_hash, undefined, 'nunca se envía el hash');

  assert.equal((await call('POST', '/api/auth/register', { email: 'ana@correo.es', password: 'otra-clave-9' })).status, 409);
  assert.equal((await call('POST', '/api/auth/login', { email: 'ana@correo.es', password: 'mala-clave-1' })).status, 401);
  const ok = await call('POST', '/api/auth/login', { email: ' ANA@correo.es ', password: 'gatitos-2026' });
  assert.equal(ok.status, 200);
  const me = await call('GET', '/api/players/me', undefined, ok.body.token);
  assert.equal(me.body.name, 'Anita');
});

test('bloqueo tras 5 intentos fallidos', async () => {
  mail.configured = () => false;
  await call('POST', '/api/auth/register', { email: 'leo@correo.es', password: 'leones-y-tigres' });
  for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { email: 'leo@correo.es', password: `mala-${i}-xxxx` });
  const locked = await call('POST', '/api/auth/login', { email: 'leo@correo.es', password: 'leones-y-tigres' });
  assert.equal(locked.status, 429);
});

test('con correo: hay que confirmar, y se puede recuperar la contraseña', async () => {
  mail.configured = () => true;
  sent.length = 0;
  const r = await call('POST', '/api/auth/register', { email: 'eva@correo.es', password: 'manzanas-verdes' });
  assert.equal(r.status, 201);
  assert.equal(r.body.needsVerification, true);
  assert.equal(r.body.token, undefined);

  const early = await call('POST', '/api/auth/login', { email: 'eva@correo.es', password: 'manzanas-verdes' });
  assert.equal(early.status, 403);
  assert.equal(early.body.code, 'unverified');

  const v = await call('POST', '/api/auth/verify', { token: tokenFrom(sent[0].url) });
  assert.equal(v.status, 200);
  assert.ok(v.body.token);
  assert.equal((await call('POST', '/api/auth/verify', { token: tokenFrom(sent[0].url) })).status, 400, 'un solo uso');
  assert.equal((await call('POST', '/api/auth/login', { email: 'eva@correo.es', password: 'manzanas-verdes' })).status, 200);

  // Recuperar: responde igual exista o no el correo.
  assert.equal((await call('POST', '/api/auth/forgot', { email: 'nadie@correo.es' })).status, 200);
  await call('POST', '/api/auth/forgot', { email: 'eva@correo.es' });
  const reset = sent.find((m) => m.kind === 'reset');
  assert.ok(reset);
  const rr = await call('POST', '/api/auth/reset', { token: tokenFrom(reset.url), password: 'peras-maduras' });
  assert.equal(rr.status, 200);
  assert.equal((await call('GET', '/api/players/me', undefined, v.body.token)).status, 401, 'cierra las demás sesiones');
  assert.equal((await call('POST', '/api/auth/login', { email: 'eva@correo.es', password: 'peras-maduras' })).status, 200);
});

test('Google con el mismo correo entra en la misma cuenta', async () => {
  mail.configured = () => false;
  const r = await call('POST', '/api/auth/register', { email: 'marta@example.com', password: 'flores-de-mayo', name: 'Marta' });
  // El login de prueba de Google usa el correo <nombre>@example.com.
  const g = await login(base, 'Marta', { email: 'marta@example.com' });
  assert.equal(g.player.id, r.body.player.id);
  assert.equal((await call('POST', '/api/auth/register', { email: 'otro@example.com', password: 'xx-largo-123' })).status, 201);
});
