const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createServer } = require('../core/server');
const { setDbForTests } = require('../core/db');
const { CQ } = require('../modules/conquista/config');
const { ConquistaGame } = require('../modules/conquista/game');
const { REGIONS, ADJ } = require('../modules/conquista/map');
const { createFakeDb } = require('./fakeDb');
const { login } = require('./login');

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

test('el dueño de un país puede usarlo como aliado al atacar', async () => {
  const andorra = { id: 'ad', name: 'Andorra', flag: '🇦🇩' };
  const players = [
    { id: 'h', name: 'Humana', countries: [andorra] },
    ...['a', 'b'].map((id) => ({ id, name: `Bot ${id}`, isBot: true, skill: 0.6 })),
  ];
  let asked = null;
  let seen = null;
  await new Promise((resolve, reject) => {
    let sentAlly = false;
    const game = new ConquistaGame({
      code: 'CALLY',
      players,
      send: (id, s) => {
        assert.deepEqual(s.myCountries, [andorra]);
        if (s.phase === 'bat_pick' && s.picker === 'h' && !sentAlly) {
          sentAlly = true;
          setImmediate(() => game.handle('h', { t: 'cq_ally', country: 'ad' }));
        }
        if (s.phase === 'bat_question' && s.attack?.attackerId === 'h' && !seen) {
          seen = s;
          game.destroy();
          clearTimeout(timer);
          resolve();
        }
      },
      loadNumeric: async (n) => numeric(n),
      loadChoice: async (n) => choice(n),
      allyQuestion: (id) => {
        asked = id;
        return { text: '🇦🇩 Pregunta de Andorra', options: ['W', 'X', 'Y', 'Z'], correctIndex: 2, category: 'general' };
      },
      onFinished: async (g, r) => r,
      onEmpty: () => {},
    });
    const timer = setTimeout(() => reject(new Error('la humana nunca atacó')), 30_000);
    game.run().catch(() => {});
  });
  assert.equal(asked, 'ad');
  assert.equal(seen.ally.id, 'ad');
  assert.equal(seen.question.text, '🇦🇩 Pregunta de Andorra');
  assert.match(seen.event, /aliado 🇦🇩 Andorra/);
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
  return login(base, name);
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

test('«Jugar ya» en la cola empieza al momento, sin esperar a la cuenta atrás', async () => {
  const prev = CQ.botWaitMs;
  CQ.botWaitMs = 60_000;
  try {
    const p = await newPlayer('Prisas');
    const t0 = Date.now();
    let started = 0;
    const r = await simpleClient(p.token, (ws, seen) => {
      ws.send(JSON.stringify({ t: 'cq_queue' }));
      ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.t === 'cq_queued' && !seen.asked) {
          seen.asked = true;
          ws.send(JSON.stringify({ t: 'cq_now' }));
        }
        if (m.t === 'cq_state' && !started) started = Date.now();
      });
    });
    assert.ok(r.final, r.error);
    assert.ok(started - t0 < 3_000, 'empieza enseguida');
    assert.equal(r.final.players.filter((x) => x.isBot).length, 2);
  } finally {
    CQ.botWaitMs = prev;
  }
});

// Cliente sencillo: responde cualquier cosa (sirve para las preguntas +18, que no siguen el patrón «Pregunta n»).
function simpleClient(token, onWelcome) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base}/ws`);
    const seen = { phases: new Set(), msgs: [] };
    let lastKey = '';
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', token })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      seen.msgs.push(m);
      if (m.t === 'welcome') onWelcome(ws, seen);
      if (m.t === 'error') {
        ws.close();
        return resolve({ error: m.message, seen });
      }
      if (m.t !== 'cq_state') return;
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
      if (m.phase === 'bat_question') ws.send(JSON.stringify({ t: 'cq_choice', option: 0 }));
      if (m.phase === 'exp_question' || m.phase === 'bat_tiebreak') ws.send(JSON.stringify({ t: 'cq_guess', value: 10 }));
    });
    ws.on('error', reject);
  });
}

const makeAdult = (id) => (db.tables.players.find((p) => p.id === id).birthdate = '1990-01-01');

test('modo +18: solo mayores de edad', async () => {
  const teen = await newPlayer('Menor');
  const r = await simpleClient(teen.token, (ws) => ws.send(JSON.stringify({ t: 'cq_queue', variant: 'x18' })));
  assert.match(r.error, /mayores de edad/);
});

test('modo +18: partida privada en pareja con preguntas +18', async () => {
  const a = await newPlayer('Pareja A');
  const b = await newPlayer('Pareja B');
  makeAdult(a.player.id);
  makeAdult(b.player.id);
  const before = db.tables.players.find((p) => p.id === a.player.id).conquista_played;
  let code;
  const host = simpleClient(a.token, (ws, seen) => {
    ws.send(JSON.stringify({ t: 'cq_private', variant: 'x18' }));
    const wait = setInterval(() => {
      const m = seen.msgs.find((x) => x.t === 'cq_private');
      if (m) {
        clearInterval(wait);
        code = m.code;
      }
    }, 5);
  });
  while (!code) await new Promise((r) => setTimeout(r, 10));
  const guest = simpleClient(b.token, (ws) => ws.send(JSON.stringify({ t: 'cq_join', code })));
  const [ra, rb] = await Promise.all([host, guest]);
  assert.ok(ra.final && rb.final, ra.error || rb.error);
  assert.equal(ra.final.code, rb.final.code);
  assert.equal(ra.final.variant, 'x18');
  assert.equal(ra.final.players.length, 2);
  assert.equal(ra.final.players.filter((p) => p.isBot).length, 0);
  const asked = ra.seen.msgs.filter((m) => m.t === 'cq_state' && m.question).map((m) => m.question.text);
  const { CHOICE, NUMERIC } = require('../modules/adult/questions');
  const bank = new Set([...CHOICE, ...NUMERIC].map((q) => q.text));
  assert.ok(asked.length > 0 && asked.every((t) => bank.has(t)), 'solo preguntas +18');
  assert.ok(db.tables.matches.some((m) => m.mode === 'conquista18'));
  assert.equal(db.tables.players.find((p) => p.id === a.player.id).conquista_played, before, 'no cuenta en el ranking normal');
});

test('Conquista con amigos: código privado para 3 y empezar antes con bots', async () => {
  const [h, g1, g2] = await Promise.all(['Anfitriona', 'Amigo Uno', 'Amiga Dos'].map((n) => newPlayer(n)));
  let code;
  const host = simpleClient(h.token, (ws, seen) => {
    ws.send(JSON.stringify({ t: 'cq_private' }));
    const wait = setInterval(() => {
      const m = seen.msgs.find((x) => x.t === 'cq_private');
      if (m) {
        clearInterval(wait);
        code = m.code;
      }
    }, 5);
  });
  while (!code) await new Promise((r) => setTimeout(r, 10));
  assert.match(code, /^C/);
  const c1 = simpleClient(g1.token, (ws) => ws.send(JSON.stringify({ t: 'cq_join', code })));
  // Espera a que el primero esté dentro para que el orden sea fijo.
  await new Promise((r) => setTimeout(r, 80));
  const c2 = simpleClient(g2.token, (ws) => ws.send(JSON.stringify({ t: 'cq_join', code })));
  const [rh, r1, r2] = await Promise.all([host, c1, c2]);
  assert.ok(rh.final && r1.final && r2.final, rh.error || r1.error || r2.error);
  assert.equal(rh.final.code, r2.final.code);
  assert.equal(rh.final.players.length, 3);
  assert.equal(rh.final.players.filter((p) => p.isBot).length, 0, 'tres humanos, sin bots');
  // La sala de espera avisaba de quién había entrado.
  const lobby = rh.seen.msgs.filter((m) => m.t === 'cq_lobby');
  assert.ok(lobby.some((m) => m.members.length === 2 && m.needed === 3));

  // Con un solo amigo, el anfitrión puede empezar ya y el hueco lo ocupa un bot.
  const [h2, g3] = await Promise.all(['Impaciente', 'Amigo Tres'].map((n) => newPlayer(n)));
  let code2;
  let hostWs;
  const host2 = simpleClient(h2.token, (ws, seen) => {
    hostWs = ws;
    ws.send(JSON.stringify({ t: 'cq_private' }));
    const wait = setInterval(() => {
      const m = seen.msgs.find((x) => x.t === 'cq_private');
      if (m) {
        clearInterval(wait);
        code2 = m.code;
      }
    }, 5);
  });
  while (!code2) await new Promise((r) => setTimeout(r, 10));
  const c3 = simpleClient(g3.token, (ws) => ws.send(JSON.stringify({ t: 'cq_join', code: code2 })));
  await new Promise((r) => setTimeout(r, 80));
  hostWs.send(JSON.stringify({ t: 'cq_private_bot' }));
  const [rh2, r3] = await Promise.all([host2, c3]);
  assert.ok(rh2.final && r3.final, rh2.error || r3.error);
  assert.equal(rh2.final.players.filter((p) => p.isBot).length, 1);
});
