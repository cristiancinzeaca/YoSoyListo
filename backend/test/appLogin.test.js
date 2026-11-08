const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../core/server');
const { setDbForTests } = require('../core/db');
const { createFakeDb } = require('./fakeDb');

let server;
let base;

test.before(async () => {
  process.env.DEV_FAKE_GOOGLE = '1';
  setDbForTests(createFakeDb());
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  delete process.env.DEV_FAKE_GOOGLE;
  server.close();
});

test('login de Google desde la app: el navegador vuelve a la app con un código', async () => {
  const start = await fetch(`${base}/auth/google/app?next=/conquista&dev=Lucia`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const callback = start.headers.get('location');
  assert.match(callback, /state=app\./);
  // Sin cookie: el navegador del móvil no comparte cookies con la app.
  const back = await fetch(base + callback, { redirect: 'manual' });
  const loc = back.headers.get('location');
  assert.match(loc, /^\/volver-app#code=/);
  const code = decodeURIComponent(loc.split('code=')[1]);
  const done = await fetch(`${base}/api/auth/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  const body = await done.json();
  assert.equal(done.status, 200);
  assert.equal(body.next, '/conquista');
  assert.ok(body.token);
  // El mismo state no vale dos veces.
  const again = await fetch(base + callback, { redirect: 'manual' });
  assert.match(again.headers.get('location'), /^\/entrar#error=state/);
});

test('la página de vuelta a la app existe', async () => {
  const res = await fetch(`${base}/volver-app`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /volver-app\.js/);
});
