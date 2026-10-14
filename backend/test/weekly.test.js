const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../core/server');
const { setDbForTests } = require('../core/db');
const { createFakeDb } = require('./fakeDb');
const { login } = require('./login');
const weekly = require('../modules/weekly/service');
const heroes = require('../modules/heroes/service');

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

test('la semana empieza el lunes a medianoche de Madrid', () => {
  // Domingo 18/10/2026 23:30 en Madrid (21:30 UTC, horario de verano) → semana del lunes 12.
  const sun = weekly.weekOf(Date.UTC(2026, 9, 18, 21, 30));
  assert.equal(sun.week, '2026-10-12');
  assert.equal(sun.endsInMs, 30 * 60_000);
  // Lunes 19/10 00:10 en Madrid → nueva semana.
  assert.equal(weekly.weekOf(Date.UTC(2026, 9, 18, 22, 10)).week, '2026-10-19');
  // En invierno (UTC+1).
  assert.equal(weekly.weekOf(Date.UTC(2026, 11, 6, 23, 30)).week, '2026-12-07');
  assert.equal(weekly.previousWeek('2026-10-19'), '2026-10-12');
});

test('la experiencia suma en la liga y los 10 primeros cobran una sola vez', async () => {
  const ana = await login(base, 'Liga Ana');
  const beto = await login(base, 'Liga Beto');
  await heroes.addXp(ana.player.id, 120, 'test');
  await heroes.addXp(beto.player.id, 50, 'test');
  await heroes.addXp(beto.player.id, 30, 'test');

  const st = await call('GET', '/api/weekly', undefined, beto.token);
  assert.equal(st.status, 200);
  assert.deepEqual(st.body.leaderboard.map((r) => [r.name, r.points]), [['Liga Ana', 120], ['Liga Beto', 80]]);
  assert.deepEqual(st.body.me, { points: 80, rank: 2 });
  assert.equal(st.body.leaderboard[0].prize, weekly.PRIZES[0]);
  // Sin sesión también se ve la clasificación.
  assert.equal((await call('GET', '/api/weekly')).body.me, null);

  // Una semana después se reparten los premios (y repetir no paga dos veces).
  const coinsBefore = db.tables.players.find((p) => p.id === ana.player.id).coins;
  const nextWeek = Date.now() + 7 * 86_400_000;
  const r1 = await weekly.settle(nextWeek);
  assert.equal(r1.paid, 2);
  assert.equal((await weekly.settle(nextWeek)).paid, 0);
  assert.equal(db.tables.players.find((p) => p.id === ana.player.id).coins, coinsBefore + weekly.PRIZES[0]);

  // El ganador ve su premio una vez.
  const won = await call('GET', '/api/weekly', undefined, ana.token);
  assert.deepEqual(won.body.won.map((w) => [w.rank, w.coins]), [[1, weekly.PRIZES[0]]]);
  assert.equal((await call('POST', '/api/weekly/seen', {}, ana.token)).status, 200);
  assert.equal((await call('GET', '/api/weekly', undefined, ana.token)).body.won.length, 0);
});
