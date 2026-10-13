const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../core/server');
const { setDbForTests } = require('../core/db');
const { createFakeDb } = require('./fakeDb');
const { login } = require('./login');
const C = require('../modules/heroes/catalog');
const heroes = require('../modules/heroes/service');
const { matchXp, blitzXp } = require('../modules/heroes/rewards');

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

test('curva de niveles y catálogo coherentes', () => {
  assert.deepEqual(C.levelFromXp(0), { level: 1, into: 0, next: 100 });
  assert.equal(C.levelFromXp(99).level, 1);
  assert.equal(C.levelFromXp(100).level, 2);
  assert.equal(C.levelFromXp(250).level, 3);
  assert.equal(C.levelFromXp(10_000_000).level, C.MAX_LEVEL);
  for (const slot of C.SLOTS) {
    assert.equal(C.ITEMS[C.DEFAULT_EQUIP[slot]].level, 1, `${slot} empieza con algo de nivel 1`);
  }
  for (const it of Object.values(C.ITEMS)) assert.ok(C.SLOTS.includes(it.slot) && it.level >= 1 && it.level <= C.MAX_LEVEL, it.id);
});

test('XP por partida', () => {
  const duel = [{ position: 1 }, { position: 2 }];
  assert.equal(matchXp('duel', duel[0], duel), C.XP.duel.win);
  assert.equal(matchXp('duel', duel[1], duel), C.XP.duel.loss);
  assert.equal(matchXp('duel', { position: 1, left: true }, duel), 0);
  const vsBot = [{ position: 1 }, { position: 2, isBot: true }];
  assert.equal(matchXp('duel', vsBot[0], vsBot), Math.round(C.XP.duel.win * C.XP.botFactor));
  assert.equal(matchXp('conquista', { position: 1 }, [{ position: 1 }]), C.XP.conquista[0]);
  assert.equal(blitzXp(10), 10 * C.XP.blitzPerCorrect);
});

test('crear héroe, subir de nivel y equipar lo desbloqueado', async () => {
  const ana = await login(base, 'Ana');
  assert.equal(ana.player.hero, null);
  assert.equal(ana.player.level, 1);

  assert.equal((await call('POST', '/api/heroes/me', { race: 'trol', cls: 'mago', sex: 'h' }, ana.token)).status, 400);
  const made = await call('POST', '/api/heroes/me', { race: 'elfo', cls: 'mago', sex: 'm' }, ana.token);
  assert.equal(made.status, 200);
  assert.deepEqual(made.body.hero.equip, C.DEFAULT_EQUIP);
  assert.equal(made.body.hero.title, 'Novato');

  // Aún no puede ponerse la cota de hierro (nivel 3).
  assert.equal((await call('POST', '/api/heroes/equip', { slot: 'armadura', item: 'hierro' }, ana.token)).status, 403);
  assert.equal((await call('POST', '/api/heroes/equip', { slot: 'arma', item: 'hierro' }, ana.token)).status, 400);

  const up = await heroes.addXp(ana.player.id, 260, 'test');
  assert.equal(up.level, 3);
  assert.equal(up.levelUp, true);
  assert.deepEqual(up.rewards.map((r) => r.id).sort(), ['bronce', 'hierro']);

  const eq = await call('POST', '/api/heroes/equip', { slot: 'armadura', item: 'hierro' }, ana.token);
  assert.equal(eq.status, 200);
  assert.equal(eq.body.hero.equip.armadura, 'hierro');
  assert.equal(eq.body.power, 3 * 20 + C.ITEMS.hierro.power);

  // Lo ven los demás (en /api/players/me y en las salas).
  const me = await call('GET', '/api/players/me', undefined, ana.token);
  assert.equal(me.body.hero.race, 'elfo');
  assert.equal(me.body.level, 3);

  // Cambiar de aspecto cuesta monedas y conserva nivel y equipo.
  row(ana.player.id).coins = 100;
  assert.equal((await call('POST', '/api/heroes/me', { race: 'orco', cls: 'mago', sex: 'm' }, ana.token)).status, 409);
  row(ana.player.id).coins = 500;
  const changed = await call('POST', '/api/heroes/me', { race: 'orco', cls: 'mago', sex: 'm' }, ana.token);
  assert.equal(changed.body.hero.race, 'orco');
  assert.equal(changed.body.hero.equip.armadura, 'hierro');
  assert.equal(row(ana.player.id).coins, 200);
});

test('los bots tienen héroe y el equipo inválido se corrige', () => {
  const b = heroes.botHero();
  assert.ok(b.hero && C.RACES[b.hero.race] && b.level >= 1);
  const s = heroes.summary({ xp: 0, hero: { race: 'enano', cls: 'explorador', sex: 'h', equip: { armadura: 'celestial', arma: 'sol' } } });
  assert.equal(s.hero.equip.armadura, 'cuero', 'no puede llevar algo de nivel 50 siendo nivel 1');
  assert.equal(s.hero.equip.arma, 'ninguna');
});
