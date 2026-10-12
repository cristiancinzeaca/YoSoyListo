const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createServer } = require('../core/server');
const { setDbForTests } = require('../core/db');
const { CQ } = require('../modules/conquista/config');
const { ConquistaGame } = require('../modules/conquista/game');
const { REGIONS, ADJ } = require('../modules/conquista/map');
const { createFakeDb } = require('./fakeDb');

Object.assign(CQ, { introMs: 20, numericMs: 300, choiceMs: 300, pickMs: 250, resultMs: 20, botWaitMs: 200 });

const numeric = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `n${i}`, text: `Número ${i}`, answer: 1000 + i, unit: 'año', category: 'historia' }));
const choice = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    text: `Pregunta ${i}`,
    options: ['A', 'B', 'C', 'D'],
    correctIndex: i % 4,
    category: 'general',
    explanation: null,
  }));

test('el mapa es coherente: vecindades simétricas y todo conectado', () => {
  assert.equal(REGIONS.length, 17);
  for (const r of REGIONS) for (const n of ADJ[r]) assert.ok(ADJ[n].includes(r), `${r} ↔ ${n}`);
  const seen = new Set(['madrid']);
  const stack = ['madrid'];
  while (stack.length) for (const n of ADJ[stack.pop()]) if (!seen.has(n)) seen.add(n), stack.push(n);
  assert.equal(seen.size, 17);
});

test('una partida solo de bots termina con todo el mapa repartido', async () => {
  let saved = null;
  const bots = ['a', 'b', 'c'].map((id) => ({ id, name: `Bot ${id}`, isBot: true, skill: 0.6 }));
  await new Promise((resolve, reject) => {
    const game = new ConquistaGame({
      code: 'CTEST',
      players: bots,
      send: () => {},
      loadNumeric: async (n) => numeric(n),
      loadChoice: async (n) => choice(n),
      onFinished: async (g, ranking) => {
        saved = ranking;
        return ranking;
      },
      onEmpty: () => reject(new Error('no debería destruirse')),
    });
    const timeout = setTimeout(() => reject(new Error('la partida no terminó')), 30_000);
    const check = setInterval(() => {
      if (game.status === 'finished') {
        clearInterval(check);
        clearTimeout(timeout);
        // Al final no queda ninguna región libre y cada castillo sigue teniendo dueño.
        assert.ok(REGIONS.every((r) => game.owner[r] !== null));
        assert.ok(game.players.every((p) => game.owner[p.castle] !== null));
        resolve();
      }
    }, 20);
    game.run();
  });
  assert.equal(saved.length, 3);
  assert.equal(saved[0].position, 1);
  assert.ok(saved[0].score >= saved[2].score);
  const total = saved.reduce((s, r) => s + r.regions, 0);
  assert.equal(total, 17);
});

// ---------- partidas reales por WebSocket ----------
let server;
let base;
let db;

test.before(async () => {
  db = createFakeDb();
  setDbForTests(db);
  for (const q of numeric(30)) db.tables.numeric_questions.push({ ...q, id: undefined, active: true });
  db.tables.numeric_questions.forEach((q, i) => (q.id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`));
  for (let i = 0; i < 30; i++) {
    db.tables.questions.push({
      id: `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`,
      text: `Pregunta ${i}`,
      options: ['A', 'B', 'C', 'D'],
      correct_index: i % 4,
      category: 'general',
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

async function newPlayer(name) {
  const res = await fetch(`http://${base}/api/players`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

// Cliente que juega solo: responde lo que le toque en cada estado.
function autoPlayer(token, { right = true } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base}/ws`);
    const seen = { states: 0, phases: new Set(), queued: false };
    let lastKey = '';
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', token })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'welcome') ws.send(JSON.stringify({ t: 'cq_queue' }));
      if (m.t === 'cq_queued') seen.queued = true;
      if (m.t === 'error') reject(new Error(m.message));
      if (m.t !== 'cq_state') return;
      seen.states++;
      seen.phases.add(m.phase);
      if (m.phase === 'end') {
        ws.close();
        return resolve({ final: m, seen });
      }
      const mine = m.participants.includes(m.you) && m.myAnswer === null;
      const key = `${m.phase}:${m.round}:${m.question?.text}:${m.picker}:${(m.options || []).length}`;
      if (!mine || key === lastKey) return;
      lastKey = key;
      if (m.phase.endsWith('_pick')) ws.send(JSON.stringify({ t: 'cq_pick', region: m.options[0] }));
      if (m.phase === 'bat_question') {
        const n = Number(m.question.text.split(' ')[1]);
        ws.send(JSON.stringify({ t: 'cq_choice', option: right ? n % 4 : (n + 1) % 4 }));
      }
      if (m.phase === 'exp_question' || m.phase === 'bat_tiebreak') {
        const n = Number(m.question.text.split(' ')[1]);
        ws.send(JSON.stringify({ t: 'cq_guess', value: 1000 + n + (right ? 0 : 50) }));
      }
    });
    ws.on('error', reject);
  });
}

test('un jugador solo juega Conquista contra dos bots', async () => {
  const { player, token } = await newPlayer('Conquistadora');
  const { final, seen } = await autoPlayer(token);
  assert.ok(seen.queued);
  for (const phase of ['intro', 'exp_question', 'exp_result', 'exp_pick', 'bat_pick', 'end']) {
    assert.ok(seen.phases.has(phase), `fase ${phase}`);
  }
  assert.equal(final.players.filter((p) => p.isBot).length, 2);
  assert.equal(final.result.ranking.length, 3);
  const stored = db.tables.players.find((p) => p.id === player.id);
  assert.equal(stored.conquista_played, 1);
  assert.ok(db.tables.matches.some((m) => m.mode === 'conquista'));
});

test('tres personas en cola empiezan juntas sin bots', async () => {
  const ps = await Promise.all(['Uno', 'Dos', 'Tres'].map(newPlayer));
  const results = await Promise.all(ps.map((p, i) => autoPlayer(p.token, { right: i === 0 })));
  const final = results[0].final;
  assert.equal(final.players.filter((p) => p.isBot).length, 0);
  assert.equal(new Set(results.map((r) => r.final.code)).size, 1, 'misma partida');
  const winners = final.result.ranking.filter((r) => r.position === 1).map((r) => r.name);
  assert.ok(winners.length >= 1);
});
