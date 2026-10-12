const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../core/server');
const { setDbForTests } = require('../core/db');
const { createFakeDb } = require('./fakeDb');

const ADMIN_KEY = 'clave-de-prueba';
let server;
let base;
let db;

test.before(async () => {
  process.env.ADMIN_KEY = ADMIN_KEY;
  db = createFakeDb();
  setDbForTests(db);
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

async function call(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const admin = { 'X-Admin-Key': ADMIN_KEY };

test('health y web pública', async () => {
  assert.deepEqual((await call('GET', '/health')).body, { status: 'ok', service: 'yosoylisto-backend' });
  const home = await fetch(`${base}/`);
  assert.match(await home.text(), /Yo Soy/);
  const blitz = await fetch(`${base}/blitz`);
  assert.equal(blitz.status, 200);
  assert.equal((await call('GET', '/api/nada')).status, 404);
});

test('las rutas de admin exigen la clave', async () => {
  assert.equal((await call('GET', '/api/questions')).status, 401);
  assert.equal((await call('GET', '/api/questions', undefined, { 'X-Admin-Key': 'mala' })).status, 401);
  assert.equal((await call('POST', '/api/questions', {})).status, 401);
});

test('CRUD de preguntas', async () => {
  const created = await call('POST', '/api/questions', {
    text: '¿Capital de Italia?', options: ['Roma', 'Milán'], correctIndex: 0, category: 'Geografía',
  }, admin);
  assert.equal(created.status, 201);
  assert.equal(created.body.category, 'geografia');

  const bad = await call('POST', '/api/questions', { text: '¿?', options: [] }, admin);
  assert.equal(bad.status, 400);

  const id = created.body.id;
  const updated = await call('PUT', `/api/questions/${id}`, {
    text: '¿Capital de Italia?', options: ['Milán', 'Roma'], correctIndex: 1, category: 'geografia', active: false,
  }, admin);
  assert.equal(updated.body.correctIndex, 1);
  assert.equal(updated.body.active, false);

  const list = await call('GET', '/api/questions?search=italia', undefined, admin);
  assert.equal(list.body.total, 1);

  assert.equal((await call('DELETE', `/api/questions/${id}`, undefined, admin)).status, 204);
  assert.equal((await call('DELETE', `/api/questions/${id}`, undefined, admin)).status, 404);
  assert.equal((await call('DELETE', '/api/questions/no-es-uuid', undefined, admin)).status, 404);
});

test('partida Blitz completa', async () => {
  const questions = Array.from({ length: 5 }, (_, i) => ({
    text: `Pregunta número ${i + 1}`,
    options: ['A', 'B', 'C'],
    correctIndex: i % 3,
    category: 'general',
  }));
  const bulk = await call('POST', '/api/questions/bulk', questions, admin);
  assert.equal(bulk.body.inserted, 5);

  const cats = await call('GET', '/api/questions/categories');
  assert.deepEqual(cats.body.categories, [{ category: 'general', total: 5 }]);

  const start = await call('POST', '/api/blitz/start', {});
  assert.equal(start.status, 201);
  const { sessionId, questions: qs } = start.body;
  assert.equal(qs.length, 5);
  assert.equal(qs[0].correctIndex, undefined, 'no debe filtrar la respuesta correcta');

  // No se puede cerrar antes de tiempo.
  assert.equal((await call('POST', `/api/blitz/${sessionId}/finish`, {})).status, 409);

  const correctOf = (q) => questions.find((x) => x.text === q.text).correctIndex;
  let last;
  for (const [i, q] of qs.entries()) {
    const option = i === 3 ? (correctOf(q) + 1) % 3 : correctOf(q); // falla la cuarta
    last = await call('POST', `/api/blitz/${sessionId}/answer`, { questionId: q.id, optionIndex: option });
    assert.equal(last.status, 200);
  }
  // 10 + 10 + 10 + 0 + 10
  assert.equal(last.body.score, 40);
  assert.equal(last.body.streak, 1);

  const again = await call('POST', `/api/blitz/${sessionId}/answer`, { questionId: qs[0].id, optionIndex: 0 });
  assert.equal(again.status, 409);

  const finished = await call('POST', `/api/blitz/${sessionId}/finish`, {});
  assert.equal(finished.status, 200);
  assert.equal(finished.body.correctCount, 4);
  assert.equal(finished.body.bestStreak, 3);

  assert.equal((await call('POST', `/api/blitz/${sessionId}/finish`, { name: 'x' })).status, 400);
  const named = await call('POST', `/api/blitz/${sessionId}/finish`, { name: 'Ana' });
  assert.equal(named.body.rank, 1);
  assert.equal((await call('POST', `/api/blitz/${sessionId}/finish`, { name: 'Otra' })).status, 409);

  const board = await call('GET', '/api/blitz/leaderboard?period=all');
  assert.equal(board.body.entries[0].name, 'Ana');
  assert.equal(board.body.entries[0].score, 40);
});

test('no se aceptan respuestas fuera de tiempo', async () => {
  const start = await call('POST', '/api/blitz/start', {});
  const { sessionId, questions: qs } = start.body;
  const session = db.tables.blitz_sessions.find((s) => s.id === sessionId);
  session.ends_at = new Date(Date.now() - 10_000).toISOString();
  const late = await call('POST', `/api/blitz/${sessionId}/answer`, { questionId: qs[0].id, optionIndex: 0 });
  assert.equal(late.status, 409);
  assert.equal((await call('POST', `/api/blitz/${sessionId}/finish`, {})).status, 200);
});
