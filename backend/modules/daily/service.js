// Reto diario: las mismas 10 preguntas para todos cada día (hora de Madrid), un intento por persona,
// clasificación del día y racha de días seguidos.
const { getDb, dbError } = require('../../core/db');
const { httpError, isUuid } = require('../../core/http');
const { today } = require('../players/age');
const heroes = require('../heroes/service');

const DAILY = {
  questions: 10,
  questionMs: 15_000,
  graceMs: 1_500,
  points: 100, // por acierto
  speedPoints: 10, // por cada segundo que sobra
  coinsBase: 10,
  coinsPerCorrect: 3,
  streakCoins: 5, // por día de racha (hasta 7)
  xpBase: 20,
  xpPerCorrect: 5,
  milestones: { 7: 100, 30: 500, 100: 2000 }, // monedas extra al llegar a esa racha
};

const iso = (v) => (v instanceof Date ? v.toISOString() : v);
const dayStr = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

async function loadRun(playerId, day) {
  const { data, error } = await getDb().from('daily_runs').select('*').eq('player_id', playerId).eq('day', day).maybeSingle();
  if (error) throw dbError(error, 'daily.load');
  return data;
}

function questionOut(run, i) {
  const q = run.questions.list[i];
  return { index: i, total: run.questions.list.length, text: q.text, options: q.options, category: q.category, ms: DAILY.questionMs };
}

async function leaderboard(day, limit = 20) {
  const db = getDb();
  const { data, error } = await db
    .from('daily_runs')
    .select('player_id, score, correct, finished_at')
    .eq('day', day)
    .eq('status', 'done')
    .order('score', { ascending: false })
    .order('finished_at', { ascending: true })
    .limit(limit);
  if (error) throw dbError(error, 'daily.board');
  if (!data.length) return [];
  const { data: people, error: pErr } = await db.from('players').select('id, name, avatar, hero').in('id', data.map((r) => r.player_id));
  if (pErr) throw dbError(pErr, 'daily.board.players');
  const byId = new Map(people.map((p) => [p.id, p]));
  return data.map((r, i) => {
    const p = byId.get(r.player_id) || {};
    return { rank: i + 1, playerId: r.player_id, name: p.name || '¿?', avatar: p.avatar || null, hero: p.hero || null, score: r.score, correct: r.correct };
  });
}

async function myRank(day, score) {
  const { count, error } = await getDb()
    .from('daily_runs')
    .select('id', { count: 'exact', head: true })
    .eq('day', day)
    .eq('status', 'done')
    .gt('score', score);
  if (error) throw dbError(error, 'daily.rank');
  return (count || 0) + 1;
}

async function streakOf(playerId) {
  const { data, error } = await getDb().from('players').select('streak, streak_best, streak_day').eq('id', playerId).maybeSingle();
  if (error) throw dbError(error, 'daily.streak');
  if (!data) return { streak: 0, best: 0 };
  // Si ayer no jugó, la racha ya está rota (aunque en la base aún no se haya puesto a 0).
  const d = today();
  const yesterday = new Date(Date.parse(`${d}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const last = data.streak_day ? dayStr(data.streak_day) : null;
  const alive = last === d || last === yesterday;
  return { streak: alive ? data.streak : 0, best: data.streak_best, playedToday: last === d };
}

function summary(run) {
  return {
    score: run.score,
    correct: run.correct,
    total: run.questions.list.length,
    answers: (run.answers && run.answers.list) || [], // [true/false…] para compartir el resultado
  };
}

// Estado del reto de hoy.
async function state(playerId) {
  const day = today();
  const [run, streak, board] = await Promise.all([loadRun(playerId, day), streakOf(playerId), leaderboard(day)]);
  const out = { day, streak, leaderboard: board, questions: DAILY.questions, seconds: DAILY.questionMs / 1000 };
  if (run && run.status === 'done') {
    out.played = true;
    out.result = { ...summary(run), rank: await myRank(day, run.score) };
  } else {
    out.played = false;
    out.inProgress = !!run;
  }
  return out;
}

// Empezar (o seguir) el reto de hoy.
async function start(playerId) {
  const day = today();
  let run = await loadRun(playerId, day);
  if (run && run.status === 'done') throw httpError(409, 'Ya has jugado el reto de hoy. ¡Vuelve mañana!');
  if (!run) {
    const { data, error } = await getDb().rpc('daily_questions', { p_day: day, p_limit: DAILY.questions });
    if (error) throw dbError(error, 'daily.questions');
    if (!data || data.length < DAILY.questions) throw httpError(503, 'No hay preguntas suficientes para el reto');
    const list = data.map((q) => ({ id: q.id, text: q.text, options: q.options, correctIndex: q.correct_index, category: q.category }));
    const { data: created, error: insErr } = await getDb()
      .from('daily_runs')
      .insert({ player_id: playerId, day, questions: { list }, deadline: new Date(Date.now() + DAILY.questionMs + DAILY.graceMs).toISOString() })
      .select('*')
      .single();
    if (insErr && insErr.code === '23505') run = await loadRun(playerId, day);
    else if (insErr) throw dbError(insErr, 'daily.start');
    else run = created;
  } else if (Date.parse(iso(run.deadline)) < Date.now()) {
    // Volvió después de que se acabara el tiempo de la pregunta: cuenta como fallo.
    return answer(playerId, run.id, { index: run.current, option: -1 }, { resumed: true });
  }
  const left = Math.max(0, Date.parse(iso(run.deadline)) - DAILY.graceMs - Date.now());
  return { runId: run.id, question: { ...questionOut(run, run.current), ms: Math.min(DAILY.questionMs, left) }, correct: run.correct, score: run.score };
}

async function answer(playerId, runId, { index, option } = {}, { resumed = false } = {}) {
  if (!isUuid(runId)) throw httpError(404, 'Reto no encontrado');
  const db = getDb();
  const { data: run, error } = await db.from('daily_runs').select('*').eq('id', runId).maybeSingle();
  if (error) throw dbError(error, 'daily.answer.load');
  if (!run || run.player_id !== playerId) throw httpError(404, 'Reto no encontrado');
  if (run.status !== 'active') throw httpError(409, 'El reto ya ha terminado');
  if (Number(index) !== run.current) throw httpError(409, 'Esa pregunta ya está respondida');
  const q = run.questions.list[run.current];
  const deadline = Date.parse(iso(run.deadline));
  const now = Date.now();
  const late = now > deadline;
  const right = !late && Number(option) === q.correctIndex;
  const secondsLeft = Math.max(0, Math.floor((deadline - DAILY.graceMs - now) / 1000));
  const gained = right ? DAILY.points + secondsLeft * DAILY.speedPoints : 0;
  const next = run.current + 1;
  const finished = next >= run.questions.list.length;
  const answers = { list: [...((run.answers && run.answers.list) || []), right] }; // objeto: jsonb no acepta arrays sueltos desde pgdb
  const { data: saved, error: uErr } = await db
    .from('daily_runs')
    .update({
      current: next,
      correct: run.correct + (right ? 1 : 0),
      score: run.score + gained,
      answers,
      status: finished ? 'done' : 'active',
      finished_at: finished ? new Date().toISOString() : null,
      deadline: new Date(now + DAILY.questionMs + DAILY.graceMs).toISOString(),
    })
    .eq('id', run.id)
    .eq('current', run.current)
    .eq('status', 'active')
    .select('*');
  if (uErr) throw dbError(uErr, 'daily.answer.save');
  if (!saved.length) throw httpError(409, 'Respuesta duplicada');
  const after = saved[0];
  const out = { right, late, resumed, correctIndex: q.correctIndex, gained, score: after.score, correct: after.correct };
  if (!finished) {
    out.question = questionOut(after, next);
    out.runId = after.id;
    return out;
  }
  return { ...out, done: true, ...(await finish(playerId, after)) };
}

// Fin del reto: racha, monedas y XP.
async function finish(playerId, run) {
  const db = getDb();
  const { data: st, error } = await db.rpc('finish_daily', { p_id: playerId, p_day: dayStr(run.day) });
  if (error) throw dbError(error, 'daily.finish');
  const streak = st && st[0] ? st[0].streak : 1;
  const best = st && st[0] ? st[0].best : streak;
  const milestone = DAILY.milestones[streak] || 0;
  const coins = DAILY.coinsBase + run.correct * DAILY.coinsPerCorrect + Math.min(streak, 7) * DAILY.streakCoins + milestone;
  const { data: c, error: cErr } = await db.rpc('add_coins', { p_id: playerId, p_amount: coins, p_reason: `daily:${dayStr(run.day)}` });
  if (cErr) console.error('[reto] monedas', cErr.message);
  const xp = await heroes.safeXp(playerId, DAILY.xpBase + run.correct * DAILY.xpPerCorrect, 'daily');
  const day = dayStr(run.day);
  return {
    result: { ...summary(run), rank: await myRank(day, run.score) },
    streak: { streak, best, milestone },
    rewards: { coins, balance: c && c[0] ? c[0].balance : null, xp },
    leaderboard: await leaderboard(day),
  };
}

module.exports = { DAILY, state, start, answer };
