const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createServer } = require('../core/server');
const { setDbForTests } = require('../core/db');
const { createFakeDb } = require('./fakeDb');
const { login: loginBase } = require('./login');

// Jugadores con nivel suficiente para chatear y comprar países.
async function login(b, name, opts) {
  const r = await loginBase(b, name, opts);
  db.tables.players.find((p) => p.id === r.player.id).xp = 1000;
  return r;
}
const chat = require('../modules/chat/service');
const { cleanMessage } = require('../modules/chat/filter');

let server;
let base;
let db;

test.before(async () => {
  db = createFakeDb();
  setDbForTests(db);
  server = createServer().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.multiplayer.close();
  server.close();
});

test.beforeEach(() => chat.resetMemory());

async function call(method, path, body, token, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('el filtro tapa tacos, enlaces y teléfonos', () => {
  assert.equal(cleanMessage('eres un cabrón').text, 'eres un ******');
  assert.equal(cleanMessage('PUUUTA').text, '******');
  assert.equal(cleanMessage('el cono de helado').text, 'el cono de helado');
  assert.equal(cleanMessage('entra en www.spam.com').text, 'entra en [enlace]');
  assert.equal(cleanMessage('llámame al 612 345 678').text, 'llámame al [número]');
  assert.equal(cleanMessage('Mi correo: ana@gmail.com').text, 'Mi correo: [correo]');
  assert.equal(cleanMessage('   ').error, 'Escribe un mensaje');
  assert.match(cleanMessage('x'.repeat(201)).error, /200/);
});

test('sala general: escribir, leer, límites y bloqueos', async () => {
  const ana = await login(base, 'Ana');
  const beto = await login(base, 'Beto');
  assert.equal((await call('GET', '/api/chat/lobby')).status, 401);

  const sent = await call('POST', '/api/chat/lobby', { text: 'Hola a todos, ¿quién juega?' }, ana.token);
  assert.equal(sent.status, 201);
  assert.equal(sent.body.message.from.name, 'Ana');

  // Demasiado rápido.
  assert.equal((await call('POST', '/api/chat/lobby', { text: 'otra cosa' }, ana.token)).status, 429);

  const read = await call('GET', '/api/chat/lobby', undefined, beto.token);
  assert.deepEqual(read.body.messages.map((m) => m.text), ['Hola a todos, ¿quién juega?']);

  // Beto bloquea a Ana: deja de ver sus mensajes.
  assert.equal((await call('POST', `/api/chat/block/${ana.player.id}`, {}, beto.token)).status, 200);
  assert.equal((await call('GET', '/api/chat/lobby', undefined, beto.token)).body.messages.length, 0);
  const s = await call('GET', '/api/chat/settings', undefined, beto.token);
  assert.deepEqual(s.body.blocked.map((p) => p.name), ['Ana']);
  await call('DELETE', `/api/chat/block/${ana.player.id}`, undefined, beto.token);
  assert.equal((await call('GET', '/api/chat/lobby', undefined, beto.token)).body.messages.length, 1);
});

test('privados: conversación, no leídos, bloqueo y opción de no recibir', async () => {
  const eva = await login(base, 'Eva');
  const leo = await login(base, 'Leo');

  const found = await call('GET', '/api/chat/search?name=le', undefined, eva.token);
  assert.ok(found.body.players.some((p) => p.id === leo.player.id));

  assert.equal((await call('POST', `/api/chat/dm/${leo.player.id}`, { text: '¿Echamos un duelo?' }, eva.token)).status, 201);
  let inbox = await call('GET', '/api/chat/dm', undefined, leo.token);
  assert.equal(inbox.body.unread, 1);
  assert.equal(inbox.body.conversations[0].with.name, 'Eva');

  const thread = await call('GET', `/api/chat/dm/${eva.player.id}`, undefined, leo.token);
  assert.deepEqual(thread.body.messages.map((m) => m.text), ['¿Echamos un duelo?']);
  assert.equal(thread.body.canWrite, true);
  inbox = await call('GET', '/api/chat/dm', undefined, leo.token);
  assert.equal(inbox.body.unread, 0, 'al abrirla queda leída');

  // Otro jugador no puede leer ni reportar ese privado.
  const intruso = await login(base, 'Intruso');
  const msgId = thread.body.messages[0].id;
  assert.equal((await call('POST', '/api/chat/report', { messageId: msgId, reason: 'spam' }, intruso.token)).status, 404);

  // Leo bloquea a Eva: ella ya no puede escribirle.
  await call('POST', `/api/chat/block/${eva.player.id}`, {}, leo.token);
  const denied = await call('POST', `/api/chat/dm/${leo.player.id}`, { text: 'hola??' }, eva.token);
  assert.equal(denied.status, 403);
  await call('DELETE', `/api/chat/block/${eva.player.id}`, undefined, leo.token);

  // Leo cierra los privados.
  chat.resetMemory();
  await call('PATCH', '/api/chat/settings', { dmOpen: false }, leo.token);
  const closed = await call('POST', `/api/chat/dm/${leo.player.id}`, { text: 'hola de nuevo' }, eva.token);
  assert.equal(closed.status, 403);
  assert.match(closed.body.error, /no acepta mensajes privados/);
});

test('tres reportes ocultan el mensaje; tres mensajes ocultados silencian al autor', async () => {
  const malo = await login(base, 'Malo');
  const testigos = [];
  for (const n of ['T1', 'T2', 'T3']) testigos.push(await login(base, n));
  for (let i = 0; i < 3; i++) {
    chat.resetMemory();
    const m = await call('POST', '/api/chat/lobby', { text: `mensaje feo ${i}` }, malo.token);
    for (const t of testigos) {
      const r = await call('POST', '/api/chat/report', { messageId: m.body.message.id, reason: 'insultos' }, t.token);
      assert.equal(r.status, 201);
    }
  }
  const visible = await call('GET', '/api/chat/lobby', undefined, testigos[0].token);
  assert.ok(!visible.body.messages.some((m) => m.from.name === 'Malo'));
  chat.resetMemory();
  const muted = await call('POST', '/api/chat/lobby', { text: 'ya me porto bien' }, malo.token);
  assert.equal(muted.status, 403);

  // Panel de administración.
  process.env.ADMIN_KEY = 'clave-test';
  const list = await call('GET', '/api/chat/admin/reports', undefined, null, { 'X-Admin-Key': 'clave-test' });
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 3);
  const first = list.body.items[0].message.id;
  await call('POST', `/api/chat/admin/reports/${first}`, { action: 'dismiss' }, null, { 'X-Admin-Key': 'clave-test' });
  assert.equal((await call('GET', '/api/chat/admin/reports', undefined, null, { 'X-Admin-Key': 'clave-test' })).body.items.length, 2);
});

test('chat de partida por WebSocket (y el bloqueo también vale aquí)', async () => {
  const a = await login(base, 'Jugadora A');
  const b = await login(base, 'Jugador B');
  const wsUrl = base.replace('http', 'ws') + '/ws';
  const open = (token) =>
    new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);
      const inbox = [];
      ws.on('message', (d) => inbox.push(JSON.parse(d)));
      ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', token })));
      const wait = (pred, ms = 3000) =>
        new Promise((res, rej) => {
          const t0 = Date.now();
          const tick = () => {
            const i = inbox.findIndex(pred);
            if (i >= 0) return res(inbox.splice(i, 1)[0]);
            if (Date.now() - t0 > ms) return rej(new Error('timeout'));
            setTimeout(tick, 10);
          };
          tick();
        });
      resolve({ ws, wait, inbox, send: (m) => ws.send(JSON.stringify(m)) });
    });
  const ca = await open(a.token);
  const cb = await open(b.token);
  await ca.wait((m) => m.t === 'welcome');
  await cb.wait((m) => m.t === 'welcome');

  ca.send({ t: 'chat', text: 'hola' });
  assert.match((await ca.wait((m) => m.t === 'error')).message, /ninguna partida/);

  ca.send({ t: 'create_room' });
  const room = await ca.wait((m) => m.t === 'room');
  cb.send({ t: 'join_room', code: room.room.code });
  await cb.wait((m) => m.t === 'room');

  ca.send({ t: 'chat', text: '¡Suerte, crack!' });
  const got = await cb.wait((m) => m.t === 'chat');
  assert.equal(got.message.text, '¡Suerte, crack!');
  assert.equal(got.message.from.name, 'Jugadora A');
  await ca.wait((m) => m.t === 'chat');

  // B bloquea a A: deja de recibir sus mensajes de partida.
  await call('POST', `/api/chat/block/${a.player.id}`, {}, b.token);
  chat.resetMemory();
  await chat.blockedBy(b.player.id);
  ca.send({ t: 'chat', text: 'otro mensaje' });
  await ca.wait((m) => m.t === 'chat');
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!cb.inbox.some((m) => m.t === 'chat'));
  ca.ws.close();
  cb.ws.close();
});
