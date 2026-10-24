const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createServer } = require('../core/server');
const { setDbForTests } = require('../core/db');
const { CQ } = require('../modules/conquista/config');
const { ConquistaGame } = require('../modules/conquista/game');
const english = require('../modules/english/questions');
const { createFakeDb } = require('./fakeDb');
const { login } = require('./login');
const { sourceOf } = require('../modules/visits');

Object.assign(CQ, { introMs: 20, numericMs: 300, choiceMs: 300, pickMs: 250, resultMs: 20, botWaitMs: 200 });

let server;
let base;
let db;

test.before(async () => {
  db = createFakeDb();
  setDbForTests(db);
  server = createServer();
  server.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.multiplayer.close();
  server.close();
});

async function portalPlayer() {
  const res = await fetch(`http://${base}/api/players/portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'crazygames' }),
  });
  assert.equal(res.status, 201);
  return res.json();
}

test('portal: cuenta anónima al momento, sin correo ni fecha de nacimiento', async () => {
  const { player, token } = await portalPlayer();
  assert.equal(player.hasAccount, true);
  assert.equal(player.portal, 'crazygames');
  assert.equal(player.adult, false);
  assert.ok(player.coins > 0, 'monedas de bienvenida');
  assert.match(player.name, /^Listo\d+$/);
  const me = await fetch(`http://${base}/api/players/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
  const bad = await fetch(`http://${base}/api/players/portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'otro' }),
  });
  assert.equal(bad.status, 400);
});

test('portal: sus páginas se pueden meter en un iframe; el resto de la web, no', async () => {
  for (const path of ['/portal', '/portal/conquista']) {
    const res = await fetch(`http://${base}${path}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'self' https:/);
    assert.equal(res.headers.get('x-frame-options'), null);
  }
  const home = await fetch(`http://${base}/`);
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(home.headers.get('x-frame-options'), 'SAMEORIGIN');
  const robots = await (await fetch(`http://${base}/robots.txt`)).text();
  assert.match(robots, /Disallow: \/portal/);
});

test('preguntas en inglés: bien formadas', () => {
  assert.ok(english.CHOICE.length >= 300);
  assert.ok(english.NUMERIC.length >= 100);
  const texts = new Set();
  for (const q of english.CHOICE) {
    assert.ok(q.text.length > 8, q.text);
    assert.equal(q.wrong.length, 3, q.text);
    assert.equal(new Set(q.wrong).size, 3, q.text);
    assert.ok(!q.wrong.includes(q.correct), q.text);
    assert.ok(!texts.has(q.text), `repetida: ${q.text}`);
    texts.add(q.text);
  }
  for (const q of english.NUMERIC) assert.ok(Number.isFinite(q.answer) && q.unit, q.text);
});

test('Conquista en inglés: los avisos de la partida salen en inglés', async () => {
  const players = ['a', 'b', 'c'].map((id) => ({ id, name: `Bot ${id}`, isBot: true, skill: 0.6 }));
  const events = new Set();
  await new Promise((resolve) => {
    const game = new ConquistaGame({
      code: 'EN1',
      players,
      send: () => {},
      loadNumeric: english.loadNumeric,
      loadChoice: english.loadChoice,
      onFinished: async (g, r) => r,
      onEmpty: () => {},
      lang: 'en',
    });
    const spy = setInterval(() => {
      if (game.event) events.add(game.event);
      if (game.status === 'finished') {
        clearInterval(spy);
        resolve();
      }
    }, 5);
    game.run();
  });
  const all = [...events].join(' | ');
  assert.match(all, /Each player starts with a castle/);
  assert.match(all, /claims|conquers|attacks/);
  assert.match(all, /Game over/);
  assert.doesNotMatch(all, /ocupa |conquista |ataca |Fin de la partida/);
});

test('portal en inglés: partida contra bots con preguntas en inglés', async () => {
  const { token } = await portalPlayer();
  const englishTexts = new Set([...english.CHOICE, ...english.NUMERIC].map((q) => q.text));
  const asked = new Set();
  const final = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base}/ws`);
    let lastKey = '';
    const timer = setTimeout(() => reject(new Error('la partida no terminó')), 60_000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', token })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'welcome') ws.send(JSON.stringify({ t: 'cq_queue', variant: 'en' }));
      if (m.t === 'error') reject(new Error(m.message));
      if (m.t !== 'cq_state') return;
      if (m.question) asked.add(m.question.text);
      if (m.phase === 'end') {
        clearTimeout(timer);
        ws.close();
        return resolve(m);
      }
      const mine = m.participants.includes(m.you) && m.myAnswer === null;
      const key = `${m.phase}:${m.round}:${m.question?.text}:${m.picker}:${(m.options || []).length}`;
      if (!mine || key === lastKey) return;
      lastKey = key;
      if (m.phase.endsWith('_pick')) ws.send(JSON.stringify({ t: 'cq_pick', region: m.options[0] }));
      if (m.phase === 'bat_question') ws.send(JSON.stringify({ t: 'cq_choice', option: 0 }));
      if (m.phase === 'exp_question' || m.phase === 'bat_tiebreak') ws.send(JSON.stringify({ t: 'cq_guess', value: 100 }));
    });
    ws.on('error', reject);
  });
  assert.equal(final.result.ranking.length, 3);
  assert.ok(asked.size > 0);
  for (const text of asked) assert.ok(englishTexts.has(text), `pregunta en inglés: ${text}`);
});

async function webGuest() {
  const res = await fetch(`http://${base}/api/players/portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'web' }),
  });
  assert.equal(res.status, 201);
  return res.json();
}

test('web sin cuenta: invitado al momento, sin chat, y guarda su progreso con correo', async () => {
  const { player, token } = await webGuest();
  assert.equal(player.guest, true);
  assert.equal(player.portal, null);
  assert.equal(player.hasAccount, true);
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const chat = await fetch(`http://${base}/api/chat/lobby`, { method: 'POST', headers: auth, body: JSON.stringify({ text: 'hola' }) });
  assert.equal(chat.status, 403);
  db.tables.players.find((p) => p.id === player.id).coins = 777;
  const reg = await fetch(`http://${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'invitado@example.com', password: 'clave-larga-123', name: 'Guardon', guestToken: token }),
  });
  const body = await reg.json();
  assert.equal(reg.status, 201, JSON.stringify(body));
  const p = body.player || (await (await fetch(`http://${base}/api/players/me`, { headers: auth })).json());
  assert.equal(p.id, player.id, 'misma cuenta');
  assert.equal(p.guest, false);
  assert.equal(p.coins, 777, 'conserva sus monedas');
});

test('web sin cuenta: al entrar con Google se queda la misma cuenta', async () => {
  const { player, token } = await webGuest();
  const res = await login(base, 'Gugle', { guestToken: token, email: 'gugle@example.com' });
  assert.equal(res.player.id, player.id);
  assert.equal(res.player.guest, false);
  assert.equal(res.created, false);
});

test('visitas: se cuentan las páginas (no bots ni ficheros) con su origen', async () => {
  const visits = server.visits;
  await visits.flush();
  const html = { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (iPhone) BytedanceWebview' };
  await fetch(`http://${base}/`, { headers: { ...html, Referer: 'https://www.tiktok.com/' } });
  await fetch(`http://${base}/conquista?utm_source=Instagram`, { headers: html });
  await fetch(`http://${base}/`, { headers: { Accept: 'text/html', 'User-Agent': 'Googlebot/2.1' } });
  await fetch(`http://${base}/styles.css`, { headers: html });
  await new Promise((r) => setTimeout(r, 50));
  await visits.flush();
  const rows = db.tables.visits;
  assert.deepEqual(rows.find((r) => r.page === '/' && r.source === 'tiktok'), { day: rows[0].day, source: 'tiktok', page: '/', views: 1, uniques: 1 });
  assert.ok(rows.find((r) => r.page === '/conquista' && r.source === 'instagram'));
  assert.equal(rows.reduce((a, r) => a + r.views, 0), 2, 'sin bots ni ficheros');
  const req = (h, q = {}) => ({ query: q, hostname: 'www.yosoylisto.es', get: (k) => h[k.toLowerCase()] });
  assert.equal(sourceOf(req({ referer: 'https://www.google.es/' })), 'google');
  assert.equal(sourceOf(req({})), 'directo');
  assert.equal(sourceOf(req({ referer: 'https://www.yosoylisto.es/blitz' })), 'interno');
});
