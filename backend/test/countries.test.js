const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../core/server');
const { setDbForTests } = require('../core/db');
const { createFakeDb } = require('./fakeDb');
const { login } = require('./login');
const { COUNTRIES, RULES } = require('../modules/countries/catalog');

let server;
let base;
let db;

test.before(async () => {
  db = createFakeDb();
  setDbForTests(db);
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

const coinsOf = (id) => db.tables.players.find((p) => p.id === id).coins;
const setCoins = (id, n) => (db.tables.players.find((p) => p.id === id).coins = n);

// Responde bien (o mal en la pregunta `failAt`) leyendo la respuesta del banco.
function answerFor(question, countryId, wrong = false) {
  const bank = COUNTRIES[countryId].questions;
  const q = bank.find((x) => question.text === x.text);
  const right = question.options.indexOf(q.options[q.correctIndex]);
  return wrong ? (right + 1) % question.options.length : right;
}

test('todas las preguntas de los países son válidas', () => {
  for (const c of Object.values(COUNTRIES)) {
    assert.ok(c.questions.length >= RULES.baseQuestions + RULES.defenseQuestions, `${c.id} tiene pocas preguntas`);
    const texts = new Set();
    for (const q of c.questions) {
      assert.equal(q.options.length, 4, `${c.id}: ${q.text}`);
      assert.equal(new Set(q.options).size, 4, `${c.id}: opciones repetidas en ${q.text}`);
      assert.ok(!texts.has(q.text), `${c.id}: pregunta repetida ${q.text}`);
      texts.add(q.text);
    }
  }
});

test('comprar, estudiar, defender, rentas y fortificar', async () => {
  const ana = await login(base, 'Ana');
  const beto = await login(base, 'Beto');
  const list = (await call('GET', '/api/countries')).body.countries;
  assert.equal(list.find((c) => c.id === 'ad').owner, null);

  assert.equal((await call('POST', '/api/countries/ad/buy', {}, ana.token)).status, 409, 'solo tiene 100 monedas');
  setCoins(ana.player.id, 5000);
  const bought = await call('POST', '/api/countries/ad/buy', {}, ana.token);
  assert.equal(bought.status, 200);
  assert.equal(bought.body.coins, 4000);
  setCoins(beto.player.id, 5000);
  assert.equal((await call('POST', '/api/countries/ad/buy', {}, beto.token)).status, 409, 'ya tiene dueño');
  assert.equal((await call('POST', '/api/countries/zz/buy', {}, beto.token)).status, 404);

  const listed = (await call('GET', '/api/countries')).body.countries.find((c) => c.id === 'ad');
  assert.equal(listed.owner.name, 'Ana');

  // Estudio: solo el dueño ve las respuestas.
  assert.equal((await call('GET', '/api/countries/ad/study', undefined, beto.token)).status, 403);
  const study = (await call('GET', '/api/countries/ad/study', undefined, ana.token)).body;
  assert.equal(study.questions.filter((q) => q.base).length, 10);
  assert.equal(study.questions.filter((q) => q.defense).length, 10);
  assert.ok(study.questions[0].answer);

  // Elegir defensa: 10 que no sean de las fijas.
  assert.equal((await call('POST', '/api/countries/ad/defense', { seqs: [0, 1, 2] }, ana.token)).status, 400);
  const chosen = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29];
  const def = (await call('POST', '/api/countries/ad/defense', { seqs: chosen }, ana.token)).body;
  assert.deepEqual(def.questions.filter((q) => q.defense).map((q) => q.seq), chosen);

  // Rentas: 5 % al día, como mucho 3 días acumulados.
  db.tables.country_owners.find((o) => o.country === 'ad').income_at = new Date(Date.now() - 10 * 86400000).toISOString();
  const income = (await call('POST', '/api/countries/collect', {}, ana.token)).body;
  assert.equal(income.amount, 150);

  // Fortificar: cuesta el precio del país y añade 5 preguntas.
  const fort = (await call('POST', '/api/countries/ad/fortify', {}, ana.token)).body;
  assert.equal(fort.defenseSize, 15);
  assert.equal(coinsOf(ana.player.id), 4000 + 150 - 1000);
  const mine = (await call('GET', '/api/countries/mine', undefined, ana.token)).body.countries;
  assert.equal(mine[0].fortify, 1);
  assert.equal(mine[0].dailyIncome, 50);
});

test('ataque fallido: el dueño cobra y el país sube de valor; no se puede repetir el mismo día', async () => {
  const owner = await login(base, 'Dueña');
  const atk = await login(base, 'Atacante');
  setCoins(owner.player.id, 3000);
  await call('POST', '/api/countries/pt/buy', {}, owner.token);
  setCoins(atk.player.id, 150);

  assert.equal((await call('POST', '/api/countries/pt/attack', {}, owner.token)).status, 409, 'no a uno mismo');
  const start = await call('POST', '/api/countries/pt/attack', {}, atk.token);
  assert.equal(start.status, 201);
  assert.equal(start.body.question.total, 20);
  assert.equal(start.body.coins, 50);
  assert.equal(start.body.question.correctIndex, undefined, 'nunca se envía la respuesta');

  let q = start.body.question;
  let res = await call('POST', `/api/countries/attacks/${start.body.attackId}/answer`, { index: q.index, option: answerFor(q, 'pt') }, atk.token);
  assert.equal(res.body.result, 'next');
  q = res.body.question;
  res = await call('POST', `/api/countries/attacks/${start.body.attackId}/answer`, { index: q.index, option: answerFor(q, 'pt', true) }, atk.token);
  assert.equal(res.body.result, 'lost');
  assert.equal(res.body.reason, 'wrong');
  assert.equal(res.body.correct, undefined, 'no revela la respuesta correcta');

  assert.equal(coinsOf(owner.player.id), 500 + 100);
  assert.equal(db.tables.country_owners.find((o) => o.country === 'pt').value, 2600);
  setCoins(atk.player.id, 500);
  assert.equal((await call('POST', '/api/countries/pt/attack', {}, atk.token)).status, 429);
});

test('ataque perfecto: conquista el país y el antiguo dueño cobra el 50 %', async () => {
  const owner = await login(base, 'Reina');
  const atk = await login(base, 'Sabia');
  setCoins(owner.player.id, 2500);
  await call('POST', '/api/countries/gr/buy', {}, owner.token);
  setCoins(atk.player.id, 100);

  const start = await call('POST', '/api/countries/gr/attack', {}, atk.token);
  let q = start.body.question;
  let res;
  for (let i = 0; i < 20; i++) {
    res = await call('POST', `/api/countries/attacks/${start.body.attackId}/answer`, { index: q.index, option: answerFor(q, 'gr') }, atk.token);
    if (res.body.result !== 'next') break;
    q = res.body.question;
  }
  assert.equal(res.body.result, 'won');
  const row = db.tables.country_owners.find((o) => o.country === 'gr');
  assert.equal(row.player_id, atk.player.id);
  assert.equal(coinsOf(owner.player.id), 1250);
});

test('responder tarde cuenta como fallo', async () => {
  const owner = await login(base, 'Lenta');
  const atk = await login(base, 'Tardón');
  setCoins(owner.player.id, 2500);
  await call('POST', '/api/countries/ma/buy', {}, owner.token);
  setCoins(atk.player.id, 100);
  const start = await call('POST', '/api/countries/ma/attack', {}, atk.token);
  db.tables.country_attacks.find((a) => a.id === start.body.attackId).deadline = new Date(Date.now() - 5000).toISOString();
  const q = start.body.question;
  const res = await call('POST', `/api/countries/attacks/${start.body.attackId}/answer`, { index: q.index, option: answerFor(q, 'ma') }, atk.token);
  assert.equal(res.body.result, 'lost');
  assert.equal(res.body.reason, 'timeout');
});
