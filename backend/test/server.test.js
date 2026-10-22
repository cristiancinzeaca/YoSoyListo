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

test('páginas de preguntas con respuestas para Google', async () => {
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const idx = await fetch(`${base}/preguntas`);
    assert.equal(idx.status, 200);
    assert.match(await idx.text(), /Preguntas de trivial con respuestas/);
    const cat = await (await fetch(`${base}/preguntas/historia`)).text();
    assert.match(cat, /<h1>Preguntas de historia con respuestas \(\d+\)<\/h1>/);
    assert.match(cat, /<title>\d+\+? preguntas de historia con respuestas/);
    const trampa = await fetch(`${base}/preguntas/preguntas-trampa`);
    assert.equal(trampa.status, 200);
    assert.match(await trampa.text(), /Si adelantas al segundo/);
    assert.match(cat, /<details><summary>Ver respuesta<\/summary>/);
    assert.match(cat, /rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/preguntas\/historia"/);
    assert.equal((await fetch(`${base}/preguntas/inventada`)).status, 404);
    const map = await (await fetch(`${base}/sitemap.xml`)).text();
    assert.match(map, /\/preguntas\/deportes<\/loc>/);
    assert.match(map, /\/preguntas\/halloween<\/loc>/);
  } finally {
    server.close();
  }
});

test('assetlinks.json para la app de Android', async () => {
  process.env.ANDROID_CERT_SHA256 = 'aa:bb, no-vale';
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/.well-known/assetlinks.json`);
    assert.equal(res.status, 200);
    const [entry] = await res.json();
    assert.equal(entry.target.package_name, 'es.yosoylisto.app');
    assert.deepEqual(entry.relation, ['delegate_permission/common.handle_all_urls']);
    assert.equal(entry.target.sha256_cert_fingerprints.length, 1);
    assert.match(entry.target.sha256_cert_fingerprints[0], /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  } finally {
    delete process.env.ANDROID_CERT_SHA256;
    server.close();
  }
});
