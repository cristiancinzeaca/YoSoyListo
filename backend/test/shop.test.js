const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../core/server');
const { setDbForTests } = require('../core/db');
const { createFakeDb } = require('./fakeDb');
const { login } = require('./login');
const google = require('../modules/auth/google');
const { hashToken } = require('../modules/players/service');
const { matchCoins, blitzCoins } = require('../modules/shop/rewards');

let server;
let base;
let db;

test.before(async () => {
  db = createFakeDb();
  setDbForTests(db);
  for (let i = 0; i < 10; i++) {
    db.tables.questions.push({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      text: `Pregunta ${i}`, options: ['A', 'B', 'C', 'D'], correct_index: i % 4,
      category: 'general', difficulty: 1, explanation: null, active: true,
    });
  }
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('el perfil de invitado se convierte en cuenta al entrar con Google', async () => {
  const guestToken = 'token-de-invitado-de-prueba-123456';
  const guestId = '11111111-1111-4111-8111-111111111111';
  db.tables.players.push({
    id: guestId, name: 'Invitada', token_hash: hashToken(guestToken), rating: 1040, duels_played: 3, duels_won: 2,
    rooms_played: 0, rooms_won: 0, conquista_played: 1, conquista_won: 1, google_sub: null, coins: 0, avatar: null,
  });
  // Sin cuenta, el token antiguo ya no sirve para jugar.
  const before = await call('GET', '/api/players/me', undefined, guestToken);
  assert.equal(before.status, 401);
  assert.equal(before.body.code, 'login');

  const first = await login(base, 'Laura', { guestToken, sub: 'google-laura' });
  assert.equal(first.created, true);
  assert.equal(first.player.id, guestId, 'conserva el mismo perfil');
  assert.equal(first.player.name, 'Invitada');
  assert.equal(first.player.rating, 1040);
  assert.equal(first.player.hasAccount, true);
  assert.equal(first.player.coins, 100);

  // Otro dispositivo: misma cuenta, otra sesión; las dos valen.
  const second = await login(base, 'Laura', { sub: 'google-laura' });
  assert.equal(second.created, false);
  assert.equal(second.player.id, guestId);
  assert.notEqual(second.token, first.token);
  assert.equal((await call('GET', '/api/players/me', undefined, first.token)).status, 200);
  assert.equal((await call('GET', '/api/players/me', undefined, second.token)).status, 200);

  // Cerrar sesión solo cierra ese dispositivo.
  await call('POST', '/api/auth/logout', {}, second.token);
  assert.equal((await call('GET', '/api/players/me', undefined, second.token)).status, 401);
  assert.equal((await call('GET', '/api/players/me', undefined, first.token)).status, 200);

  // Los códigos de acceso son de un solo uso.
  const code = google.createLoginCode({ sub: 'x1', name: 'X' });
  assert.equal((await call('POST', '/api/auth/complete', { code })).status, 200);
  assert.equal((await call('POST', '/api/auth/complete', { code })).status, 400);
});

test('tienda: monedas, comodines y avatares', async () => {
  const { player, token } = await login(base, 'Compradora');
  const catalog = await call('GET', '/api/shop/catalog');
  assert.ok(catalog.body.helpers.find((h) => h.id === 'fifty'));
  let w = (await call('GET', '/api/shop/me', undefined, token)).body;
  assert.equal(w.coins, 100);
  assert.deepEqual(w.helpers, { fifty: 1, time: 1, skip: 1, hint: 1 });
  assert.ok(w.avatars.includes(w.avatar), 'empieza con un avatar gratis');

  w = (await call('POST', '/api/shop/buy', { item: 'fifty' }, token)).body;
  assert.equal(w.coins, 60);
  assert.equal(w.helpers.fifty, 2);
  assert.equal((await call('POST', '/api/shop/buy', { item: 'avatar:toro' }, token)).status, 409);
  assert.equal((await call('POST', '/api/shop/buy', { item: 'diamantes' }, token)).status, 400);
  assert.equal((await call('POST', '/api/shop/avatar', { avatar: 'toro' }, token)).status, 403);

  db.tables.players.find((p) => p.id === player.id).coins += 200;
  w = (await call('POST', '/api/shop/buy', { item: 'avatar:toro' }, token)).body;
  assert.equal(w.coins, 110);
  assert.ok(w.avatars.includes('toro'));
  assert.equal((await call('POST', '/api/shop/buy', { item: 'avatar:toro' }, token)).status, 409);
  w = (await call('POST', '/api/shop/avatar', { avatar: 'toro' }, token)).body;
  assert.equal(w.avatar, 'toro');
  assert.equal((await call('GET', '/api/players/me', undefined, token)).body.avatar, 'toro');
  assert.equal((await call('GET', '/api/shop/me')).status, 401);
});

test('comodines del Blitz', async () => {
  const { token } = await login(base, 'Rapida');
  const start = await call('POST', '/api/blitz/start', {}, token);
  const { sessionId, questions: qs } = start.body;
  const correct = (q) => db.tables.questions.find((x) => x.id === q.id).correct_index;
  const helper = (kind, q) => call('POST', `/api/blitz/${sessionId}/helper`, { kind, questionId: q.id }, token);

  const fifty = await helper('fifty', qs[0]);
  assert.equal(fifty.status, 200);
  assert.equal(fifty.body.remove.length, 2);
  assert.ok(!fifty.body.remove.includes(correct(qs[0])));
  assert.equal(fifty.body.left, 0);
  assert.equal((await helper('fifty', qs[0])).status, 409, 'una vez por pregunta');
  assert.equal((await helper('fifty', qs[1])).status, 409, 'ya no le quedan');
  assert.equal((await helper('hint', qs[1])).status, 400, 'la pista no es del Blitz');

  const session = db.tables.blitz_sessions.find((s) => s.id === sessionId);
  const endsBefore = Date.parse(session.ends_at);
  const time = await helper('time', qs[0]);
  assert.equal(time.body.extraMs, 10_000);
  assert.equal(Date.parse(session.ends_at), endsBefore + 10_000);

  await call('POST', `/api/blitz/${sessionId}/answer`, { questionId: qs[0].id, optionIndex: correct(qs[0]) }, token);
  const skip = await helper('skip', qs[1]);
  assert.equal(skip.body.skipped, true);
  assert.equal((await call('POST', `/api/blitz/${sessionId}/answer`, { questionId: qs[1].id, optionIndex: 0 }, token)).status, 409);
  const next = await call('POST', `/api/blitz/${sessionId}/answer`, { questionId: qs[2].id, optionIndex: correct(qs[2]) }, token);
  assert.equal(next.body.streak, 2, 'saltar no rompe la racha');
});

test('reglas de las monedas', () => {
  const duel = [{ position: 1 }, { position: 2 }];
  assert.equal(matchCoins('duel', duel[0], duel), 25);
  assert.equal(matchCoins('duel', duel[1], duel), 8);
  const tie = [{ position: 1 }, { position: 1 }];
  assert.equal(matchCoins('duel', tie[0], tie), 15);
  const vsBot = [{ position: 1 }, { position: 2, isBot: true }];
  assert.equal(matchCoins('duel', vsBot[0], vsBot), 15);
  const cq = [{ position: 1 }, { position: 2, isBot: true }, { position: 3, isBot: true }];
  assert.equal(matchCoins('conquista', cq[0], cq), 50, 'en Conquista los bots no reducen');
  assert.equal(matchCoins('room', { position: 6 }, [{ position: 6 }]), 5);
  assert.equal(matchCoins('room', { position: 1, left: true }, [{ position: 1 }]), 0, 'quien abandona no cobra');
  assert.equal(blitzCoins({ correctCount: 7, score: 90, previousBest: 100 }), 7);
  assert.equal(blitzCoins({ correctCount: 7, score: 120, previousBest: 100 }), 17);
});

test('validación del id_token de Google y de la redirección', () => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = (claims) => `${enc({ alg: 'RS256' })}.${enc(claims)}.firma`;
  const now = Date.now();
  const good = { iss: 'https://accounts.google.com', aud: 'cliente', exp: now / 1000 + 600, sub: '42', email: 'a@b.es', given_name: 'Ana' };
  assert.deepEqual(google.identityFromIdToken(jwt(good), 'cliente', now), { sub: '42', email: 'a@b.es', name: null, givenName: 'Ana' });
  assert.throws(() => google.identityFromIdToken(jwt({ ...good, aud: 'otro' }), 'cliente', now));
  assert.throws(() => google.identityFromIdToken(jwt({ ...good, iss: 'malo.com' }), 'cliente', now));
  assert.throws(() => google.identityFromIdToken(jwt({ ...good, exp: now / 1000 - 3600 }), 'cliente', now));
  assert.equal(google.safeNext('/conquista'), '/conquista');
  assert.equal(google.safeNext('/sala?c=ABCDE'), '/sala?c=ABCDE');
  assert.equal(google.safeNext('//malo.com'), '/');
  assert.equal(google.safeNext('https://malo.com'), '/');
});

test('la pista de Conquista siempre contiene la respuesta', () => {
  const { hintRange } = require('../modules/conquista/game');
  for (const r of [0, 0.5, 0.999]) {
    const [lo, hi] = hintRange({ answer: 1492, unit: 'año' }, () => r);
    assert.ok(lo <= 1492 && hi >= 1492 && hi - lo <= 31);
    const [a, b] = hintRange({ answer: 8848, unit: 'm' }, () => r);
    assert.ok(a <= 8848 && b >= 8848);
    const [c, d] = hintRange({ answer: 3.5, unit: 'kg' }, () => r);
    assert.ok(c <= 3.5 && d >= 3.5 && c >= 0);
  }
});
