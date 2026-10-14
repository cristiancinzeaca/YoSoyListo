const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../core/server');

test('la dirección antigua de Railway redirige al dominio propio', async () => {
  process.env.PUBLIC_URL = 'https://www.yosoylisto.es';
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  // fetch no deja cambiar la cabecera Host: se usa http.request.
  const get = (path, host) =>
    new Promise((resolve, reject) => {
      const req = http.request({ port, path, headers: { host } }, (res) => {
        res.resume();
        resolve({ status: res.statusCode, headers: { get: (k) => res.headers[k] } });
      });
      req.on('error', reject);
      req.end();
    });
  try {
    const r = await get('/conquista?c=ABC', 'yosoylisto-production.up.railway.app');
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), 'https://www.yosoylisto.es/conquista?c=ABC');
    assert.equal((await get('/health', 'yosoylisto-production.up.railway.app')).status, 200);
    assert.notEqual((await get('/', 'www.yosoylisto.es')).status, 301);
  } finally {
    delete process.env.PUBLIC_URL;
    server.close();
  }
});
