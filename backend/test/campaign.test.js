const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../core/server');
const { setDbForTests } = require('../core/db');
const { createFakeDb } = require('./fakeDb');
const { login } = require('./login');
const { CHAPTERS, SPEAKERS, BOSSES } = require('../modules/campaign/story');

let server;
let base;
let db;

test.before(async () => {
  db = createFakeDb();
  setDbForTests(db);
  const cats = ['general', 'arte', 'ciencia', 'deportes', 'geografia', 'historia'];
  for (let i = 0; i < 120; i++) {
    db.tables.questions.push({
      id: `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`,
      text: `Pregunta ${i}`,
      options: ['A', 'B', 'C', 'D'],
      correct_index: i % 4,
      category: cats[i % cats.length],
      difficulty: 1,
      explanation: null,
      active: true,
    });
  }
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

const correctOf = (text) => Number(text.split(' ')[1]) % 4;

test('la historia está bien formada', () => {
  const ids = new Set();
  for (const ch of CHAPTERS) {
    assert.ok(ch.nodes.some((n) => n.type === 'boss'), `${ch.id} sin jefe`);
    for (const n of ch.nodes) {
      assert.ok(!ids.has(n.id), `id repetido ${n.id}`);
      ids.add(n.id);
      if (n.type === 'story') for (const [who] of n.lines) assert.ok(who === 'heroe' || who === 'jefe' || SPEAKERS[who], `${n.id}: hablante ${who}`);
      if (n.type === 'boss') assert.ok(BOSSES[n.bossKey]);
    }
  }
});

async function win(token, nodeId, { failFirst = 0 } = {}) {
  const start = await call('POST', `/api/campaign/nodes/${nodeId}/start`, {}, token);
  assert.equal(start.status, 201, JSON.stringify(start.body));
  let q = start.body.question;
  let res;
  let fails = failFirst;
  for (;;) {
    const option = fails-- > 0 ? (correctOf(q.text) + 1) % 4 : correctOf(q.text);
    res = (await call('POST', `/api/campaign/runs/${start.body.runId}/answer`, { index: q.index, option }, token)).body;
    if (res.status !== 'active') return res;
    q = res.question;
  }
}

test('campaña: prólogo de tu raza, combates, jefe y recompensas', async () => {
  const p = await login(base, 'Aventurera');
  let ov = (await call('GET', '/api/campaign', undefined, p.token)).body;
  assert.equal(ov.hasHero, false);
  assert.ok(ov.chapters.every((c) => !c.unlocked));

  await call('POST', '/api/heroes/me', { race: 'enano', cls: 'mago', sex: 'm' }, p.token);
  ov = (await call('GET', '/api/campaign', undefined, p.token)).body;
  assert.equal(ov.chapters[0].id, 'pro-enano');
  assert.equal(ov.chapters[0].unlocked, true);
  assert.equal(ov.chapters.find((c) => c.id === 'c1').unlocked, false);

  // No se puede saltar al jefe.
  assert.equal((await call('POST', '/api/campaign/nodes/d6/start', {}, p.token)).status, 403);

  assert.equal((await call('POST', '/api/campaign/nodes/d1/read', {}, p.token)).status, 200);
  const r1 = await win(p.token, 'd2', { failFirst: 2 });
  assert.equal(r1.status, 'won');
  assert.equal(r1.first, true);
  assert.equal(r1.reward.xp, 30);

  // Perder: 3 fallos.
  await call('POST', '/api/campaign/nodes/d3/read', {}, p.token);
  const lost = await win(p.token, 'd4', { failFirst: 3 });
  assert.equal(lost.status, 'lost');
  assert.equal(lost.hearts, 0);
  assert.equal(typeof lost.correctIndex, 'number', 'enseña la respuesta correcta');

  await win(p.token, 'd4');
  await call('POST', '/api/campaign/nodes/d5/read', {}, p.token);
  const boss = await win(p.token, 'd6');
  assert.equal(boss.status, 'won');
  assert.deepEqual(boss.reward.items.map((i) => i.id), ['heroe_forja']);
  await call('POST', '/api/campaign/nodes/d7/read', {}, p.token);

  // La pieza de campaña se puede equipar.
  const eq = await call('POST', '/api/heroes/equip', { slot: 'titulo', item: 'heroe_forja' }, p.token);
  assert.equal(eq.status, 200);
  assert.equal(eq.body.hero.title, 'Señor de la Forja');
  const other = await call('POST', '/api/heroes/equip', { slot: 'titulo', item: 'vencedor' }, p.token);
  assert.equal(other.status, 403, 'no ganada todavía');

  ov = (await call('GET', '/api/campaign', undefined, p.token)).body;
  assert.equal(ov.chapters.find((c) => c.id === 'pro-enano').done, true);
  assert.equal(ov.chapters.find((c) => c.id === 'c1').unlocked, true);
  assert.equal(ov.chapters.find((c) => c.id === 'c2').unlocked, false);
  assert.equal(ov.chapters.find((c) => c.id === 'pro-orco').unlocked, true, 'los otros prólogos se abren como extra');

  // Repetir un combate ya superado no vuelve a dar premio.
  const again = await win(p.token, 'd2');
  assert.equal(again.first, false);
});
