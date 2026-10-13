const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../core/server');
const { setDbForTests } = require('../core/db');
const { createFakeDb } = require('./fakeDb');
const { login } = require('./login');
const { today } = require('../modules/players/age');

let server;
let base;
let db;

test.before(async () => {
  db = createFakeDb();
  setDbForTests(db);
  for (let i = 0; i < 40; i++) {
    db.tables.questions.push({
      id: `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`,
      text: `Pregunta ${i}`,
      options: ['A', 'B', 'C', 'D'],
      correct_index: i % 4,
      category: 'general',
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

const right = (q) => Number(q.text.split(' ')[1]) % 4;

async function play(token, { wrongAt = [] } = {}) {
  const s = await call('POST', '/api/daily/start', {}, token);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  let q = s.body.question;
  let runId = s.body.runId;
  const texts = [];
  for (;;) {
    texts.push(q.text);
    const opt = wrongAt.includes(q.index) ? (right(q) + 1) % 4 : right(q);
    const r = (await call('POST', `/api/daily/runs/${runId}/answer`, { index: q.index, option: opt }, token)).body;
    if (r.done) return { r, texts };
    q = r.question;
    runId = r.runId;
  }
}

test('reto diario: mismas preguntas para todos, un intento, clasificación y racha', async () => {
  const ana = await login(base, 'Ana');
  const beto = await login(base, 'Beto');

  let st = (await call('GET', '/api/daily', undefined, ana.token)).body;
  assert.equal(st.played, false);
  assert.equal(st.day, today());
  assert.equal(st.streak.streak, 0);

  const a = await play(ana.token, { wrongAt: [2] });
  assert.equal(a.r.result.correct, 9);
  assert.equal(a.r.result.answers.length, 10);
  assert.equal(a.r.result.answers[2], false);
  assert.equal(a.r.streak.streak, 1);
  assert.ok(a.r.rewards.coins >= 10 + 9 * 3 + 5);
  assert.ok(a.r.rewards.xp.gained > 0);

  const b = await play(beto.token);
  assert.deepEqual(b.texts, a.texts, 'las mismas preguntas en el mismo orden');
  assert.equal(b.r.result.rank, 1);
  assert.equal(b.r.leaderboard[0].name, 'Beto');
  assert.equal(b.r.leaderboard[1].name, 'Ana');

  // Solo una vez al día.
  assert.equal((await call('POST', '/api/daily/start', {}, ana.token)).status, 409);
  st = (await call('GET', '/api/daily', undefined, ana.token)).body;
  assert.equal(st.played, true);
  assert.equal(st.result.rank, 2);
  assert.equal(st.streak.streak, 1);
});

test('la racha suma si jugó ayer y se rompe si no', async () => {
  const c = await login(base, 'Constante');
  const row = db.tables.players.find((p) => p.id === c.player.id);
  const yesterday = new Date(Date.parse(`${today()}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  Object.assign(row, { streak: 6, streak_best: 6, streak_day: yesterday });
  assert.equal((await call('GET', '/api/daily', undefined, c.token)).body.streak.streak, 6);
  const r = await play(c.token);
  assert.equal(r.r.streak.streak, 7);
  assert.equal(r.r.streak.milestone, 100, 'premio por 7 días seguidos');

  const d = await login(base, 'Olvidadiza');
  Object.assign(db.tables.players.find((p) => p.id === d.player.id), { streak: 4, streak_best: 4, streak_day: '2020-01-01' });
  assert.equal((await call('GET', '/api/daily', undefined, d.token)).body.streak.streak, 0, 'racha rota');
  assert.equal((await play(d.token)).r.streak.streak, 1);
});

test('si vuelve tarde a una pregunta, cuenta como fallo', async () => {
  const e = await login(base, 'Lenta');
  const s = await call('POST', '/api/daily/start', {}, e.token);
  db.tables.daily_runs.find((r) => r.id === s.body.runId).deadline = new Date(Date.now() - 5000).toISOString();
  const again = await call('POST', '/api/daily/start', {}, e.token);
  assert.equal(again.body.resumed, true);
  assert.equal(again.body.right, false);
  assert.equal(again.body.question.index, 1);
});
