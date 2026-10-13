const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../core/server');
const { setDbForTests } = require('../core/db');
const { createFakeDb } = require('./fakeDb');
const { login } = require('./login');
const age = require('../modules/players/age');

let server;
let base;
let db;

test.before(async () => {
  db = createFakeDb();
  setDbForTests(db);
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const yearsAgo = (n, md = '01-15') => `${Number(age.today().slice(0, 4)) - n}-${md}`;

test('cálculo de edad y cumpleaños', () => {
  assert.equal(age.ageOn('2000-05-10', '2026-05-09'), 25);
  assert.equal(age.ageOn('2000-05-10', '2026-05-10'), 26);
  assert.equal(age.isBirthday('2000-05-10', '2026-05-10'), true);
  assert.equal(age.isBirthday('2000-02-29', '2026-02-28'), true, 'año no bisiesto');
  assert.equal(age.isBirthday('2000-02-29', '2028-02-28'), false, 'año bisiesto: el 29');
  assert.equal(age.parseDate('2026-02-30'), null);
});

test('fecha obligatoria, una sola vez, y mayoría de edad', async () => {
  const ana = await login(base, 'Ana');
  assert.equal(ana.player.birthdateSet, false);
  assert.equal(ana.player.adult, false);
  assert.equal(ana.player.birthdate, undefined, 'la fecha nunca se envía');

  assert.equal((await call('POST', '/api/players/birthdate', { date: '1990-02-30' }, ana.token)).status, 400);
  const ok = await call('POST', '/api/players/birthdate', { date: yearsAgo(30) }, ana.token);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.birthdateSet, true);
  assert.equal(ok.body.adult, true);
  assert.equal((await call('POST', '/api/players/birthdate', { date: yearsAgo(40) }, ana.token)).status, 409, 'no se cambia');

  const teen = await login(base, 'Teen');
  const t = await call('POST', '/api/players/birthdate', { date: yearsAgo(16) }, teen.token);
  assert.equal(t.body.adult, false);
});

test('menores de 14: la cuenta se borra', async () => {
  const kid = await login(base, 'Peque');
  const r = await call('POST', '/api/players/birthdate', { date: yearsAgo(12) }, kid.token);
  assert.equal(r.status, 403);
  assert.ok(!db.tables.players.some((p) => p.id === kid.player.id));
});

test('regalo de cumpleaños: 500 monedas una vez al año', async () => {
  const cumple = await login(base, 'Cumple');
  const today = age.today();
  const r = await call('POST', '/api/players/birthdate', { date: `${Number(today.slice(0, 4)) - 25}${today.slice(4)}` }, cumple.token);
  assert.equal(r.body.birthdayGift, 500);
  assert.equal(r.body.coins, 100 + 500);
  const again = await call('GET', '/api/players/me', undefined, cumple.token);
  assert.equal(again.body.birthdayGift, undefined, 'no se repite el mismo año');
});
