const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../core/server');
const { setDbForTests } = require('../core/db');
const { createFakeDb } = require('./fakeDb');

let server;
let base;
test.before(async () => {
  setDbForTests(createFakeDb());
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const jsonld = (html) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));

test('test de cultura general: 20 preguntas, datos estructurados y categorías', async () => {
  for (const path of ['/test-de-cultura-general', '/test-de-cultura-general/historia']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200);
    const html = await res.text();
    const qs = JSON.parse(html.match(/id="test-data">(.*?)<\/script>/s)[1]);
    assert.equal(qs.length, 20);
    for (const q of qs) assert.ok(q.o.includes(q.a));
    assert.ok(jsonld(html).some((x) => x['@type'] === 'Quiz'));
  }
  assert.equal((await fetch(`${base}/test-de-cultura-general/nada`)).status, 404);
  // Otra tanda con ?s=
  const a = await (await fetch(`${base}/test-de-cultura-general?s=abc`)).text();
  const b = await (await fetch(`${base}/test-de-cultura-general?s=xyz`)).text();
  assert.notEqual(a.match(/id="test-data">(.*?)<\/script>/s)[1], b.match(/id="test-data">(.*?)<\/script>/s)[1]);
});

test('páginas de preguntas: 100 preguntas y Quiz + migas en JSON-LD', async () => {
  const res = await fetch(`${base}/preguntas/100-preguntas-de-cultura-general`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<title>100 preguntas de cultura general con respuestas/);
  assert.equal((html.match(/class="qa-item"/g) || []).length, 100);
  const types = jsonld(html).map((x) => x['@type']);
  assert.deepEqual(types.sort(), ['BreadcrumbList', 'Quiz']);
});

test('sitemap con lastmod e incluye los tests', async () => {
  const xml = await (await fetch(`${base}/sitemap.xml`)).text();
  assert.match(xml, /<loc>[^<]+\/test-de-cultura-general<\/loc><lastmod>\d{4}-\d\d-\d\d<\/lastmod>/);
  assert.match(xml, /100-preguntas-de-cultura-general/);
});
