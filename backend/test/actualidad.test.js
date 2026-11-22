const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const actualidad = require('../modules/seo/actualidad');
const { createApp } = require('../core/server');
const { setDbForTests } = require('../core/db');
const { createFakeDb } = require('./fakeDb');

test('cada página de actualidad es válida', () => {
  const dir = path.join(__dirname, '..', 'db', 'actualidad');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const errs = actualidad.problems(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), f);
    assert.deepEqual(errs, [], `${f}: ${errs.join('; ')}`);
  }
});

test('la validación detecta errores', () => {
  const errs = actualidad.problems({ slug: 'Mal Slug', date: '22-11-2026', questions: [['¿?', 'a', ['a', 'b', 'c'], 5]] }, 'x.json');
  assert.ok(errs.length >= 5);
});

test('rutas de actualidad, sitemap y 404', async () => {
  setDbForTests(createFakeDb());
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const first = actualidad.all()[0];
    const idx = await fetch(`${base}/actualidad`);
    assert.equal(idx.status, 200);
    assert.match(await idx.text(), new RegExp(`/actualidad/${first.slug}`));
    const page = await (await fetch(`${base}/actualidad/${first.slug}`)).text();
    assert.match(page, /"@type":"Quiz"/);
    assert.match(page, /"@type":"Article"/);
    assert.match(page, /<link rel="canonical" href="[^"]+\/actualidad\//);
    assert.equal((await fetch(`${base}/actualidad/no-existe`)).status, 404);
    const sm = await (await fetch(`${base}/sitemap.xml`)).text();
    assert.ok(sm.includes(`/actualidad/${first.slug}</loc><lastmod>${first.date}</lastmod>`));
  } finally {
    server.close();
  }
});
