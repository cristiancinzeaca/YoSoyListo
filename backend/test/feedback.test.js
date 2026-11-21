const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../core/server');
const { setDbForTests } = require('../core/db');
const { createFakeDb } = require('./fakeDb');

let server;
let base;
let db;
test.before(async () => {
  process.env.ADMIN_KEY = 'secreto-de-prueba';
  db = createFakeDb();
  setDbForTests(db);
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('sugerencias: se envían sin cuenta, se validan y el admin las lee y borra', async () => {
  const post = (body, ua) => fetch(`${base}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(ua ? { 'User-Agent': ua } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post({ message: 'hey' })).status, 400);
  assert.equal((await post({ message: 'Me gustaría un modo por equipos', contact: 'a@b.es' }, 'Mozilla YoSoyListoApp/1')).status, 201);
  assert.equal(db.tables.feedback.length, 1);
  assert.equal(db.tables.feedback[0].source, 'android');
  assert.equal((await fetch(`${base}/api/feedback`)).status, 401);
  const admin = { 'x-admin-key': 'secreto-de-prueba' };
  const list = await (await fetch(`${base}/api/feedback`, { headers: admin })).json();
  assert.equal(list.items[0].message, 'Me gustaría un modo por equipos');
  assert.equal((await fetch(`${base}/api/feedback/${list.items[0].id}`, { method: 'DELETE', headers: admin })).status, 200);
  assert.equal(db.tables.feedback.length, 0);
});
