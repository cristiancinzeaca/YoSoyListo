const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createServer } = require('../core/server');
const { setDbForTests } = require('../core/db');
const { config } = require('../modules/multiplayer/config');
const { createFakeDb } = require('./fakeDb');
const { login } = require('./login');

Object.assign(config, {
  questionMs: 600,
  revealMs: 60,
  countdownMs: 40,
  botWaitMs: 300,
  lobbyGraceMs: 400,
  duelQuestions: 3,
});

let server;
let base;
let db;

test.before(async () => {
  db = createFakeDb();
  setDbForTests(db);
  for (let i = 0; i < 20; i++) {
    db.tables.questions.push({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      text: `Pregunta de prueba ${i}`,
      options: ['A', 'B', 'C', 'D'],
      correct_index: i % 4,
      category: i < 10 ? 'ciencia' : 'historia',
      difficulty: 1,
      explanation: null,
      active: true,
    });
  }
  server = createServer();
  server.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.multiplayer.close();
  server.close();
});

const correctOf = (text) => db.tables.questions.find((q) => q.text === text).correct_index;

async function api(method, path, body, token) {
  const res = await fetch(`http://${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function newPlayer(name) {
  return login(base, name);
}

// Cliente de prueba: guarda todos los mensajes y permite esperar uno concreto.
function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base}/ws`);
    const client = {
      ws,
      inbox: [],
      waiters: [],
      send: (msg) => ws.send(JSON.stringify(msg)),
      waitFor(pred, timeout = 3000) {
        const idx = client.inbox.findIndex(pred);
        if (idx >= 0) return Promise.resolve(client.inbox.splice(idx, 1)[0]);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error('timeout esperando mensaje')), timeout);
          client.waiters.push({ pred, res, timer });
        });
      },
      close: () => ws.close(),
    };
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      const w = client.waiters.find((x) => x.pred(msg));
      if (w) {
        clearTimeout(w.timer);
        client.waiters.splice(client.waiters.indexOf(w), 1);
        w.res(msg);
      } else {
        client.inbox.push(msg);
      }
    });
    ws.on('open', async () => {
      if (token) {
        client.send({ t: 'hello', token });
        try {
          client.welcome = await client.waitFor((m) => m.t === 'welcome' || m.t === 'error');
        } catch (e) {
          return reject(e);
        }
      }
      resolve(client);
    });
    ws.on('error', reject);
  });
}

const is = (t) => (m) => m.t === t;

// Juega una partida entera: cada cliente decide si acierta o falla.
async function playToEnd(clients) {
  for (;;) {
    const msgs = await Promise.all(
      clients.map(({ c }) => c.waitFor((m) => m.t === 'question' || m.t === 'end', 5000))
    );
    if (msgs[0].t === 'end') return msgs;
    clients.forEach(({ c, right }, i) => {
      const q = msgs[i];
      const good = correctOf(q.question.text);
      c.send({ t: 'answer', index: q.index, option: right ? good : (good + 1) % 4 });
    });
  }
}

test('perfiles de jugador', async () => {
  const { player, token } = await newPlayer('Lucía');
  assert.equal(player.name, 'Lucía');
  assert.equal(player.rating, 1000);
  assert.equal(player.hasAccount, true);
  assert.equal(player.coins, 100);
  assert.equal((await api('POST', '/api/players', { name: 'Lucía' })).status, 410);
  assert.equal((await api('PATCH', '/api/players/me', { name: 'Bot listo' }, token)).status, 400);
  assert.equal((await api('PATCH', '/api/players/me', { name: 'gilipollas' }, token)).status, 400);
  assert.equal((await api('GET', '/api/players/me')).status, 401);
  const me = await api('GET', '/api/players/me', undefined, token);
  assert.equal(me.body.bestBlitz, 0);
  const renamed = await api('PATCH', '/api/players/me', { name: 'Lucía G' }, token);
  assert.equal(renamed.body.name, 'Lucía G');
});

test('token no válido', async () => {
  const c = await connect('x'.repeat(30));
  assert.equal(c.welcome.code, 'auth');
});

test('duelo entre dos personas con ELO', async () => {
  const a = await newPlayer('Ana');
  const b = await newPlayer('Beto');
  const ca = await connect(a.token);
  const cb = await connect(b.token);
  ca.send({ t: 'queue' });
  await ca.waitFor(is('queued'));
  cb.send({ t: 'queue' });

  const [endA, endB] = await playToEnd([
    { c: ca, right: true },
    { c: cb, right: false },
  ]);
  assert.equal(endA.mode, 'duel');
  const winner = endA.ranking[0];
  assert.equal(winner.playerId, a.player.id);
  assert.equal(winner.ratingAfter, 1016);
  assert.equal(endB.ranking[1].ratingAfter, 984);
  assert.ok(winner.score >= 1500 && winner.score <= 3000, `puntos ${winner.score}`);

  const pa = db.tables.players.find((p) => p.id === a.player.id);
  assert.equal(pa.duels_played, 1);
  assert.equal(pa.duels_won, 1);
  assert.equal(pa.rating, 1016);

  const board = await api('GET', '/api/players/leaderboard');
  assert.equal(board.body.entries[0].name, 'Ana');

  const profile = await api('GET', '/api/players/me', undefined, a.token);
  assert.equal(profile.body.recentMatches[0].ratingChange, 16);
  ca.close();
  cb.close();
});

test('duelo contra bot si no hay rival', async () => {
  const p = await newPlayer('Carla');
  const c = await connect(p.token);
  c.send({ t: 'queue' });
  const [end] = await playToEnd([{ c, right: true }]);
  assert.ok(end.ranking.some((r) => r.isBot));
  assert.equal(end.ranking.find((r) => !r.isBot).ratingAfter, null);
  const stored = db.tables.players.find((x) => x.id === p.player.id);
  assert.equal(stored.duels_played, 0, 'contra bots no cuenta para el ranking');
  assert.ok(db.tables.matches.some((m) => m.vs_bot));
  c.close();
});

test('sala privada con código, ajustes y revancha', async () => {
  const h = await newPlayer('Host');
  const g = await newPlayer('Invitado');
  const ch = await connect(h.token);
  const cg = await connect(g.token);

  ch.send({ t: 'create_room', questionCount: 5, category: 'ciencia' });
  const { room } = await ch.waitFor(is('room'));
  assert.equal(room.hostId, h.player.id);
  assert.match(room.code, /^[A-Z2-9]{5}$/);

  cg.send({ t: 'join_room', code: 'zzzzz' });
  assert.match((await cg.waitFor(is('error'))).message, /No existe/);
  cg.send({ t: 'join_room', code: room.code.toLowerCase() });
  await ch.waitFor((m) => m.t === 'room' && m.room.players.length === 2);

  cg.send({ t: 'start' });
  assert.match((await cg.waitFor(is('error'))).message, /anfitrión/);

  ch.send({ t: 'add_bot' });
  const withBot = await ch.waitFor((m) => m.t === 'room' && m.room.players.length === 3);
  assert.ok(withBot.room.players[2].isBot);

  ch.send({ t: 'start' });
  const msgs = await playToEnd([
    { c: ch, right: false },
    { c: cg, right: true },
  ]);
  const ranking = msgs[0].ranking;
  assert.equal(ranking.length, 3);
  assert.equal(ranking.find((r) => r.playerId === g.player.id).correctCount, 5);
  assert.equal(db.tables.players.find((p) => p.id === g.player.id).rooms_played, 1);

  ch.send({ t: 'rematch' });
  await cg.waitFor((m) => m.t === 'room' && m.room.status === 'lobby');
  ch.close();
  cg.close();
});

test('al reconectar tras una partida terminada se empieza de cero', async () => {
  const p = await newPlayer('Dani');
  let c = await connect(p.token);
  c.send({ t: 'queue' });
  await playToEnd([{ c, right: true }]);
  c.close();
  await new Promise((r) => setTimeout(r, 50));
  c = await connect(p.token);
  assert.equal(c.welcome.roomCode, null);
  c.send({ t: 'create_room' });
  const { room } = await c.waitFor(is('room'));
  assert.equal(room.mode, 'room');
  c.close();
});

test('volver a la sala tras perder la conexión', async () => {
  const h = await newPlayer('Vuelvo');
  const g = await newPlayer('Espero');
  let ch = await connect(h.token);
  const cg = await connect(g.token);
  ch.send({ t: 'create_room' });
  const { room } = await ch.waitFor(is('room'));
  cg.send({ t: 'join_room', code: room.code });
  await cg.waitFor(is('room'));

  ch.close();
  await cg.waitFor((m) => m.t === 'room' && m.room.players.some((p) => p.id === h.player.id && !p.connected));
  ch = await connect(h.token);
  assert.equal(ch.welcome.roomCode, room.code);
  const synced = await ch.waitFor(is('room'));
  assert.equal(synced.room.players.find((p) => p.id === h.player.id).connected, true);
  ch.close();

  // Si no vuelve a tiempo, sale de la sala y el invitado pasa a ser anfitrión.
  const after = await cg.waitFor((m) => m.t === 'room' && m.room.players.length === 1, 3000);
  assert.equal(after.room.hostId, g.player.id);
  cg.close();
});

test('informar de un error en una pregunta', async () => {
  const id = db.tables.questions[0].id;
  assert.equal((await api('POST', `/api/questions/${id}/report`, { reason: 'x' })).status, 400);
  assert.equal((await api('POST', `/api/questions/${id}/report`, { reason: 'La respuesta es otra' })).status, 201);
  process.env.ADMIN_KEY = 'k';
  const list = await api('GET', '/api/questions/reports', undefined);
  assert.equal(list.status, 401);
  const res = await fetch(`http://${base}/api/questions/reports`, { headers: { 'X-Admin-Key': 'k' } });
  const body = await res.json();
  assert.equal(body.items[0].reports[0].reason, 'La respuesta es otra');
});

test('comodín 50/50 en un duelo y monedas al acabar', async () => {
  const p = await newPlayer('Comodina');
  const c = await connect(p.token);
  c.send({ t: 'queue' });
  const q = await c.waitFor(is('question'), 5000);
  c.send({ t: 'helper', kind: 'time' });
  assert.match((await c.waitFor(is('error'))).message, /Blitz/);
  c.send({ t: 'helper', kind: 'fifty' });
  const h = await c.waitFor(is('helper'));
  assert.equal(h.kind, 'fifty');
  assert.equal(h.left, 0);
  assert.equal(h.remove.length, 2);
  assert.ok(!h.remove.includes(correctOf(q.question.text)), 'nunca quita la correcta');
  c.send({ t: 'helper', kind: 'fifty' });
  assert.match((await c.waitFor(is('error'))).message, /ya has usado/i);
  c.send({ t: 'answer', index: q.index, option: correctOf(q.question.text) });
  const [end] = await playToEnd([{ c, right: true }]);
  const mine = end.ranking.find((r) => r.playerId === p.player.id);
  // Gana contra un bot: 25 × 0,6 = 15, más 20 de bonus diario.
  assert.equal(mine.position, 1);
  assert.equal(mine.coins, 35);
  assert.equal(db.tables.players.find((x) => x.id === p.player.id).coins, 135);
  c.close();
});

test('un perfil de invitado antiguo ya no puede jugar', async () => {
  const token = 'invitado-antiguo-token-1234567890';
  db.tables.players.push({
    id: crypto.randomUUID(), name: 'Viejo', token_hash: require('../modules/players/service').hashToken(token),
    rating: 1000, duels_played: 0, duels_won: 0, rooms_played: 0, rooms_won: 0, conquista_played: 0, conquista_won: 0,
    google_sub: null, coins: 0, avatar: null,
  });
  const c = await connect(token);
  assert.equal(c.welcome.code, 'auth');
});
