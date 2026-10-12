const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../core/server');
const { setDbForTests } = require('../core/db');
const { createFakeDb } = require('./fakeDb');
const { login } = require('./login');
const { nameKey, numberedName } = require('../modules/players/names');
const { fillNameKeys } = require('../core/migrate');

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

const row = (id) => db.tables.players.find((p) => p.id === id);

test('la clave ignora mayúsculas, acentos y separadores', () => {
  assert.equal(nameKey('Cristián'), nameKey('cristian'));
  assert.equal(nameKey('Cris-Tian'), nameKey('cristian'));
  assert.equal(nameKey('Ana María'), 'anamaria');
  assert.notEqual(nameKey('Ana'), nameKey('Anna'));
  assert.equal(numberedName('Abcdefghijklmnopqrst', 12), 'Abcdefghijklmnopqr12');
});

test('al entrar con Google, un nombre repetido recibe un número', async () => {
  const a = await login(base, 'Lucía');
  const b = await login(base, 'lucia');
  const c = await login(base, 'Lucía');
  assert.equal(a.player.name, 'Lucía');
  assert.equal(b.player.name, 'lucia2');
  assert.equal(c.player.name, 'Lucía3');
});

test('cambiar de nombre cuesta 100 y no puede repetir otro', async () => {
  const pepe = await login(base, 'Pepe');
  const juan = await login(base, 'Juan');
  row(juan.player.id).coins = 250;

  // Ocupado (aunque cambien acentos o mayúsculas).
  const check = await call('GET', `/api/players/name-check?name=${encodeURIComponent('PÉPE')}`, undefined, juan.token);
  assert.deepEqual(check.body, { available: false, error: 'Ese nombre ya lo tiene otro jugador' });
  assert.equal((await call('PATCH', '/api/players/me', { name: 'pepe' }, juan.token)).status, 409);
  assert.equal(row(juan.player.id).coins, 250, 'no cobra si falla');

  // Libre: cuesta 100.
  assert.equal((await call('GET', '/api/players/name-check?name=Juanito', undefined, juan.token)).body.cost, 100);
  const ok = await call('PATCH', '/api/players/me', { name: 'Juanito' }, juan.token);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.name, 'Juanito');
  assert.equal(ok.body.coins, 150);
  assert.equal(ok.body.cost, 100);

  // Solo mayúsculas: gratis.
  assert.equal((await call('GET', '/api/players/name-check?name=JUANITO', undefined, juan.token)).body.cost, 0);
  const caps = await call('PATCH', '/api/players/me', { name: 'JUANITO' }, juan.token);
  assert.equal(caps.body.coins, 150);

  // Sin monedas suficientes.
  row(pepe.player.id).coins = 50;
  const poor = await call('PATCH', '/api/players/me', { name: 'Pepito' }, pepe.token);
  assert.equal(poor.status, 409);
  assert.match(poor.body.error, /100 monedas/);
  assert.equal(row(pepe.player.id).name, 'Pepe');

  // El nombre que dejó libre Juan ya se puede usar.
  row(pepe.player.id).coins = 100;
  assert.equal((await call('PATCH', '/api/players/me', { name: 'Juan' }, pepe.token)).status, 200);
});

test('los jugadores antiguos con nombres repetidos se separan al arrancar', async () => {
  const queries = [];
  const players = [
    { id: '1', name: 'Marta', name_key: null },
    { id: '2', name: 'marta', name_key: null },
    { id: '3', name: 'Mártá', name_key: null },
    { id: '4', name: 'Marta2', name_key: 'marta2' },
  ];
  const pool = {
    async query(sql, params) {
      queries.push(sql);
      if (sql.includes('name_key is null')) return { rows: players.filter((p) => !p.name_key) };
      if (sql.includes('name_key is not null')) return { rows: players.filter((p) => p.name_key) };
      const p = players.find((x) => x.id === params[2]);
      p.name = params[0];
      p.name_key = params[1];
      return { rows: [] };
    },
  };
  assert.equal(await fillNameKeys(pool), 3);
  assert.deepEqual(players.map((p) => p.name), ['Marta', 'marta3', 'Mártá4', 'Marta2']);
  assert.equal(new Set(players.map((p) => p.name_key)).size, 4);
});
