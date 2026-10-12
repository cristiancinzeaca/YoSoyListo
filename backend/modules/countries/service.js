const crypto = require('crypto');
const { getDb, dbError } = require('../../core/db');
const { httpError } = require('../../core/http');
const { RULES, COUNTRIES, maxFortify, defenseSize } = require('./catalog');

function country(id) {
  const c = typeof id === 'string' ? COUNTRIES[id] : null;
  if (!c) throw httpError(404, 'Ese país no existe');
  return c;
}

function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const isBase = (seq) => seq < RULES.baseQuestions;

// Preguntas de defensa: las elegidas por el dueño, completadas con las siguientes del banco si faltan.
function defenseSeqs(c, row) {
  const need = defenseSize(row.fortify || 0);
  const chosen = (row.defense || []).filter((s) => !isBase(s) && s < c.questions.length);
  const unique = [...new Set(chosen)].slice(0, need);
  for (let s = RULES.baseQuestions; unique.length < need && s < c.questions.length; s++) {
    if (!unique.includes(s)) unique.push(s);
  }
  return unique;
}

function accrued(row, now = Date.now()) {
  const days = Math.min((now - Date.parse(row.income_at)) / 86_400_000, RULES.incomeMaxDays);
  return Math.max(0, Math.floor(row.value * RULES.incomeRate * days));
}

async function owners() {
  const { data, error } = await getDb().from('country_owners').select('*');
  if (error) throw dbError(error, 'countries.owners');
  return data;
}

// Lista pública: todos los países con dueño, valor y defensas (sin preguntas).
async function list() {
  const rows = await owners();
  const ids = [...new Set(rows.map((r) => r.player_id))];
  let players = new Map();
  if (ids.length) {
    const { data, error } = await getDb().from('players').select('id, name, avatar').in('id', ids);
    if (error) throw dbError(error, 'countries.list.players');
    players = new Map(data.map((p) => [p.id, p]));
  }
  const byCountry = new Map(rows.map((r) => [r.country, r]));
  return Object.values(COUNTRIES).map((c) => {
    const row = byCountry.get(c.id);
    const owner = row ? players.get(row.player_id) : null;
    return {
      id: c.id,
      name: c.name,
      flag: c.flag,
      price: c.price,
      value: row ? row.value : c.price,
      owner: row && owner ? { id: owner.id, name: owner.name, avatar: owner.avatar || null } : null,
      questions: row ? RULES.baseQuestions + defenseSize(row.fortify) : RULES.baseQuestions + RULES.defenseQuestions,
      fortify: row ? row.fortify : 0,
      maxFortify: maxFortify(c),
      defensesWon: row ? row.defenses_won : 0,
    };
  });
}

async function mine(playerId) {
  const { data, error } = await getDb().from('country_owners').select('*').eq('player_id', playerId);
  if (error) throw dbError(error, 'countries.mine');
  const now = Date.now();
  return {
    countries: data.map((r) => {
      const c = COUNTRIES[r.country];
      return {
        id: r.country,
        name: c ? c.name : r.country,
        flag: c ? c.flag : '🏳️',
        value: r.value,
        fortify: r.fortify,
        maxFortify: c ? maxFortify(c) : 0,
        fortifyPrice: c ? c.price : 0,
        dailyIncome: Math.floor(r.value * RULES.incomeRate),
        pending: accrued(r, now),
        defensesWon: r.defenses_won,
      };
    }),
    rules: RULES,
  };
}

async function ownerRow(countryId) {
  const { data, error } = await getDb().from('country_owners').select('*').eq('country', countryId).maybeSingle();
  if (error) throw dbError(error, 'countries.ownerRow');
  return data;
}

async function buy(playerId, countryId) {
  const c = country(countryId);
  const { data, error } = await getDb().rpc('buy_country', { p_id: playerId, p_country: c.id, p_price: c.price });
  if (error) throw dbError(error, 'countries.buy');
  const row = data && data[0];
  if (!row) throw httpError(404, 'Jugador no encontrado');
  if (!row.ok) throw httpError(409, row.reason === 'taken' ? 'Ese país ya tiene dueño' : 'No tienes monedas suficientes');
  return { ok: true, coins: row.coins_left };
}

async function collect(playerId) {
  const { data, error } = await getDb().rpc('collect_income', {
    p_id: playerId,
    p_rate: RULES.incomeRate,
    p_max_days: RULES.incomeMaxDays,
  });
  if (error) throw dbError(error, 'countries.collect');
  const row = data && data[0];
  return { amount: row ? row.amount : 0, coins: row ? row.balance : null };
}

async function requireOwner(playerId, countryId) {
  const c = country(countryId);
  const row = await ownerRow(c.id);
  if (!row || row.player_id !== playerId) throw httpError(403, 'Ese país no es tuyo');
  return { c, row };
}

// El dueño estudia sus preguntas (con respuestas) y ve cuáles defienden el país.
async function study(playerId, countryId) {
  const { c, row } = await requireOwner(playerId, countryId);
  const defense = defenseSeqs(c, row);
  return {
    id: c.id,
    name: c.name,
    flag: c.flag,
    fortify: row.fortify,
    defenseSize: defenseSize(row.fortify),
    questions: c.questions.map((q) => ({
      seq: q.seq,
      text: q.text,
      answer: q.options[q.correctIndex],
      base: isBase(q.seq),
      defense: defense.includes(q.seq),
    })),
  };
}

async function setDefense(playerId, countryId, seqs) {
  const { c, row } = await requireOwner(playerId, countryId);
  const need = defenseSize(row.fortify);
  if (!Array.isArray(seqs)) throw httpError(400, 'Elige las preguntas');
  const list = [...new Set(seqs.map(Number))];
  if (list.length !== need || list.some((s) => !Number.isInteger(s) || isBase(s) || s >= c.questions.length)) {
    throw httpError(400, `Tienes que elegir exactamente ${need} preguntas que no sean de las 10 fijas`);
  }
  const { error } = await getDb().from('country_owners').update({ defense: list }).eq('country', c.id).eq('player_id', playerId).select('country');
  if (error) throw dbError(error, 'countries.setDefense');
  return study(playerId, countryId);
}

async function fortify(playerId, countryId) {
  const { c, row } = await requireOwner(playerId, countryId);
  if (row.fortify >= maxFortify(c)) throw httpError(409, 'Este país ya está fortificado al máximo');
  const { data, error } = await getDb().rpc('pay_coins', { p_id: playerId, p_amount: c.price, p_reason: `country:fortify:${c.id}` });
  if (error) throw dbError(error, 'countries.fortify.pay');
  if (!data || !data[0] || !data[0].ok) throw httpError(409, 'No tienes monedas suficientes');
  const { data: up, error: upErr } = await getDb()
    .from('country_owners')
    .update({ fortify: row.fortify + 1 })
    .eq('country', c.id)
    .eq('player_id', playerId)
    .eq('fortify', row.fortify)
    .select('country');
  if (upErr || !up || up.length === 0) {
    await getDb().rpc('add_coins', { p_id: playerId, p_amount: c.price, p_reason: `country:refund:${c.id}` });
    if (upErr) throw dbError(upErr, 'countries.fortify.update');
    throw httpError(409, 'No se pudo fortificar, inténtalo otra vez');
  }
  return { ...(await study(playerId, countryId)), coins: data[0].balance };
}

// ---------- ataques ----------
function questionOut(c, seq, perm, index, total) {
  const q = c.questions[seq];
  return { index, total, text: q.text, options: perm.map((i) => q.options[i]), ms: RULES.questionMs };
}

async function resolveLost(attack, reason) {
  const { data, error } = await getDb()
    .from('country_attacks')
    .update({ status: 'lost' })
    .eq('id', attack.id)
    .eq('status', 'active')
    .select('id');
  if (error) throw dbError(error, 'countries.attack.lost');
  if (data.length && attack.owner_id) {
    const { error: e2 } = await getDb().rpc('defend_country', {
      p_country: attack.country,
      p_owner: attack.owner_id,
      p_fee: RULES.attackCost,
      p_gain: RULES.valueGainOnDefense,
    });
    if (e2) throw dbError(e2, 'countries.attack.defend');
  }
  return { result: 'lost', reason, at: attack.current, total: attack.seqs.length };
}

// Ataques abandonados (sin responder a tiempo) se dan por perdidos.
async function closeStale(attackerId) {
  const { data, error } = await getDb().from('country_attacks').select('*').eq('attacker_id', attackerId).eq('status', 'active');
  if (error) throw dbError(error, 'countries.stale');
  for (const a of data) {
    if (Date.parse(a.deadline) + RULES.graceMs < Date.now()) await resolveLost(a, 'timeout');
  }
  return data.filter((a) => Date.parse(a.deadline) + RULES.graceMs >= Date.now());
}

async function startAttack(playerId, countryId) {
  const c = country(countryId);
  const row = await ownerRow(c.id);
  if (!row) throw httpError(409, 'Ese país no tiene dueño: puedes comprarlo');
  if (row.player_id === playerId) throw httpError(409, 'No puedes atacar tu propio país');
  const active = await closeStale(playerId);
  if (active.length) throw httpError(409, 'Ya tienes un ataque en curso');

  const since = new Date(Date.now() - RULES.attackCooldownMs).toISOString();
  const { data: recent, error: rErr } = await getDb()
    .from('country_attacks')
    .select('created_at')
    .eq('attacker_id', playerId)
    .eq('country', c.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1);
  if (rErr) throw dbError(rErr, 'countries.attack.cooldown');
  if (recent.length) {
    const hours = Math.ceil((Date.parse(recent[0].created_at) + RULES.attackCooldownMs - Date.now()) / 3_600_000);
    throw httpError(429, `Ya has atacado ${c.name} hoy. Podrás volver a intentarlo en ${hours} h.`);
  }

  const { data: paid, error: pErr } = await getDb().rpc('pay_coins', { p_id: playerId, p_amount: RULES.attackCost, p_reason: `country:attack:${c.id}` });
  if (pErr) throw dbError(pErr, 'countries.attack.pay');
  if (!paid || !paid[0] || !paid[0].ok) throw httpError(409, `Atacar cuesta ${RULES.attackCost} monedas y no tienes suficientes`);

  const seqs = shuffled([...Array(RULES.baseQuestions).keys(), ...defenseSeqs(c, row)]);
  const perms = seqs.map((s) => shuffled(c.questions[s].options.map((_, i) => i)));
  const deadline = new Date(Date.now() + RULES.questionMs).toISOString();
  const { data: attack, error } = await getDb()
    .from('country_attacks')
    .insert({ country: c.id, attacker_id: playerId, owner_id: row.player_id, seqs, perms: { p: perms }, deadline })
    .select('*')
    .single();
  if (error) {
    await getDb().rpc('add_coins', { p_id: playerId, p_amount: RULES.attackCost, p_reason: `country:attack:${c.id}:refund` });
    throw dbError(error, 'countries.attack.insert');
  }
  return { attackId: attack.id, coins: paid[0].balance, question: questionOut(c, seqs[0], perms[0], 0, seqs.length) };
}

async function answerAttack(playerId, attackId, { index, option } = {}) {
  const { data: a, error } = await getDb().from('country_attacks').select('*').eq('id', attackId).maybeSingle();
  if (error) throw dbError(error, 'countries.answer.load');
  if (!a || a.attacker_id !== playerId) throw httpError(404, 'Ataque no encontrado');
  if (a.status !== 'active') throw httpError(409, 'Este ataque ya ha terminado');
  if (Number(index) !== a.current) throw httpError(409, 'Esa pregunta ya está respondida');
  const c = country(a.country);
  if (Date.now() > Date.parse(a.deadline) + RULES.graceMs) return resolveLost(a, 'timeout');

  const seq = a.seqs[a.current];
  const perm = a.perms.p[a.current];
  const chosen = Number(option);
  const right = Number.isInteger(chosen) && perm[chosen] === c.questions[seq].correctIndex;
  if (!right) return resolveLost(a, 'wrong');

  const next = a.current + 1;
  if (next >= a.seqs.length) {
    const { data: won, error: wErr } = await getDb()
      .from('country_attacks')
      .update({ status: 'won', current: next })
      .eq('id', a.id)
      .eq('status', 'active')
      .eq('current', a.current)
      .select('id');
    if (wErr) throw dbError(wErr, 'countries.answer.won');
    if (!won.length) throw httpError(409, 'Respuesta duplicada');
    const { data: conq, error: cErr } = await getDb().rpc('conquer_country', {
      p_country: c.id,
      p_attacker: playerId,
      p_owner: a.owner_id,
      p_compensation: RULES.compensation,
    });
    if (cErr) throw dbError(cErr, 'countries.answer.conquer');
    const ok = conq && conq[0] && conq[0].ok;
    return { result: ok ? 'won' : 'changed', total: a.seqs.length, country: { id: c.id, name: c.name, flag: c.flag } };
  }
  const deadline = new Date(Date.now() + RULES.questionMs).toISOString();
  const { data: upd, error: uErr } = await getDb()
    .from('country_attacks')
    .update({ current: next, deadline })
    .eq('id', a.id)
    .eq('status', 'active')
    .eq('current', a.current)
    .select('id');
  if (uErr) throw dbError(uErr, 'countries.answer.next');
  if (!upd.length) throw httpError(409, 'Respuesta duplicada');
  return { result: 'next', question: questionOut(c, a.seqs[next], a.perms.p[next], next, a.seqs.length) };
}

// Para Conquista: países de cada jugador y una pregunta de opciones de uno de ellos.
async function ownedBy(playerIds) {
  if (!playerIds.length) return {};
  const { data, error } = await getDb().from('country_owners').select('country, player_id').in('player_id', playerIds);
  if (error) throw dbError(error, 'countries.ownedBy');
  const out = {};
  for (const r of data) {
    const c = COUNTRIES[r.country];
    if (!c) continue;
    (out[r.player_id] ||= []).push({ id: c.id, name: c.name, flag: c.flag });
  }
  return out;
}

function allyQuestion(countryId) {
  const c = COUNTRIES[countryId];
  if (!c) return null;
  const q = c.questions[crypto.randomInt(c.questions.length)];
  const perm = shuffled(q.options.map((_, i) => i));
  return {
    id: null,
    text: `${c.flag} ${q.text}`,
    options: perm.map((i) => q.options[i]),
    correctIndex: perm.indexOf(q.correctIndex),
    category: c.name,
    explanation: null,
  };
}

module.exports = { list, mine, buy, collect, study, setDefense, fortify, startAttack, answerAttack, ownedBy, allyQuestion, accrued };
