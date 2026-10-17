const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../core/server');
const { setDbForTests } = require('../core/db');
const { createFakeDb } = require('./fakeDb');
const { login } = require('./login');

test('panel de administración: actividad solo con la clave', async () => {
  process.env.ADMIN_KEY = 'clave-de-prueba';
  setDbForTests(createFakeDb());
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await login(base, 'Recién Llegada');
    assert.equal((await fetch(`${base}/api/admin/stats`)).status, 401);
    const res = await fetch(`${base}/api/admin/stats`, { headers: { 'X-Admin-Key': 'clave-de-prueba' } });
    assert.equal(res.status, 200);
    const s = await res.json();
    assert.ok(s.players >= 1);
    const me = s.recent_players.find((p) => p.name === 'Recién Llegada');
    assert.ok(me, 'aparece entre los últimos registros');
    assert.equal(me.level, 1);
    assert.ok(!me.email || me.email.includes('***'), 'el correo se muestra tapado');
  } finally {
    server.close();
  }
});
