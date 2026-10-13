const { getDb, dbError } = require('../../core/db');
const { httpError } = require('../../core/http');
const { normalizeCategory } = require('../questions/validate');
const { BLITZ, applyAnswer, acceptsAnswers, canFinish } = require('./logic');
const shop = require('../shop/service');
const { HELPERS } = require('../shop/catalog');
const { blitzCoins } = require('../shop/rewards');
const heroes = require('../heroes/service');
const { blitzXp } = require('../heroes/rewards');

const SKIPPED = -1;
const EXTRA_TIME_MS = 10_000;

function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function loadSession(id, playerId) {
  const { data, error } = await getDb().from('blitz_sessions').select('*').eq('id', id).maybeSingle();
  if (error) throw dbError(error, 'blitz.loadSession');
  // Cada partida es de su jugador: otra cuenta no puede contestar ni cerrarla.
  if (!data || (playerId && data.player_id !== playerId)) throw httpError(404, 'Partida no encontrada');
  return data;
}

async function start({ category, playerId } = {}) {
  const cat = category ? normalizeCategory(category) : null;
  const { data: questions, error } = await getDb().rpc('random_questions', {
    p_limit: BLITZ.questionsPerGame,
    p_category: cat,
  });
  if (error) throw dbError(error, 'blitz.start.questions');
  if (questions.length === 0) throw httpError(409, 'Todavía no hay preguntas disponibles');

  const now = Date.now();
  const { data: session, error: insErr } = await getDb()
    .from('blitz_sessions')
    .insert({
      category: cat,
      player_id: playerId || null,
      question_ids: questions.map((q) => q.id),
      started_at: new Date(now).toISOString(),
      ends_at: new Date(now + BLITZ.durationMs).toISOString(),
    })
    .select('id, ends_at')
    .single();
  if (insErr) throw dbError(insErr, 'blitz.start.insert');

  return {
    sessionId: session.id,
    durationMs: BLITZ.durationMs,
    endsAt: session.ends_at,
    // Nunca enviamos la respuesta correcta al navegador.
    questions: questions.map((q) => ({ id: q.id, text: q.text, options: q.options, category: q.category })),
  };
}

async function answer(sessionId, { questionId, optionIndex } = {}, playerId) {
  const session = await loadSession(sessionId, playerId);
  if (session.finished_at) throw httpError(409, 'La partida ya ha terminado');
  if (!acceptsAnswers(Date.parse(session.ends_at), Date.now())) throw httpError(409, 'Tiempo agotado');
  if (!session.question_ids.includes(questionId)) throw httpError(400, 'Esa pregunta no es de esta partida');
  if (session.answers[questionId] !== undefined) throw httpError(409, 'Esa pregunta ya está respondida');

  const { data: question, error } = await getDb()
    .from('questions')
    .select('options, correct_index, explanation')
    .eq('id', questionId)
    .maybeSingle();
  if (error) throw dbError(error, 'blitz.answer.question');
  if (!question) throw httpError(404, 'La pregunta ya no existe');

  const chosen = Number(optionIndex);
  if (!Number.isInteger(chosen) || chosen < 0 || chosen >= question.options.length) {
    throw httpError(400, 'Opción no válida');
  }

  const isCorrect = chosen === question.correct_index;
  const next = applyAnswer(
    {
      score: session.score,
      correctCount: session.correct_count,
      answeredCount: session.answered_count,
      streak: session.streak,
      bestStreak: session.best_streak,
    },
    isCorrect
  );

  // Bloqueo optimista: si llegan dos respuestas a la vez, solo cuenta una.
  const { data: updated, error: upErr } = await getDb()
    .from('blitz_sessions')
    .update({
      answers: { ...session.answers, [questionId]: chosen },
      score: next.score,
      correct_count: next.correctCount,
      answered_count: next.answeredCount,
      streak: next.streak,
      best_streak: next.bestStreak,
    })
    .eq('id', sessionId)
    .eq('answered_count', session.answered_count)
    .is('finished_at', null)
    .select('id');
  if (upErr) throw dbError(upErr, 'blitz.answer.update');
  if (updated.length === 0) throw httpError(409, 'Respuesta duplicada, inténtalo de nuevo');

  return {
    correct: isCorrect,
    correctIndex: question.correct_index,
    explanation: question.explanation,
    points: next.points,
    multiplier: next.multiplier,
    score: next.score,
    streak: next.streak,
  };
}

// Comodines del Blitz: 50/50, tiempo extra y saltar pregunta.
async function useHelper(sessionId, { kind, questionId } = {}, playerId) {
  if (!HELPERS[kind] || !HELPERS[kind].modes.includes('blitz')) throw httpError(400, 'Ese comodín no se puede usar en el Blitz');
  const session = await loadSession(sessionId, playerId);
  if (session.finished_at) throw httpError(409, 'La partida ya ha terminado');
  if (!acceptsAnswers(Date.parse(session.ends_at), Date.now())) throw httpError(409, 'Tiempo agotado');
  if (!session.question_ids.includes(questionId)) throw httpError(400, 'Esa pregunta no es de esta partida');
  if (session.answers[questionId] !== undefined) throw httpError(409, 'Esa pregunta ya está respondida');
  const used = (session.helpers && session.helpers[questionId]) || [];
  if (used.includes(kind)) throw httpError(409, 'Ya has usado ese comodín en esta pregunta');

  let remove;
  if (kind === 'fifty') {
    const { data: q, error } = await getDb().from('questions').select('options, correct_index').eq('id', questionId).maybeSingle();
    if (error) throw dbError(error, 'blitz.helper.question');
    if (!q) throw httpError(404, 'La pregunta ya no existe');
    const wrong = q.options.map((_, i) => i).filter((i) => i !== q.correct_index);
    remove = shuffled(wrong).slice(0, Math.max(0, q.options.length - 2)).sort();
  }

  const left = await shop.useItem(playerId, kind);
  if (left === null) throw httpError(409, 'No te quedan comodines de ese tipo. ¡Consíguelos en la tienda!');

  const changes = { helpers: { ...(session.helpers || {}), [questionId]: [...used, kind] } };
  let endsAt = session.ends_at;
  if (kind === 'time') {
    endsAt = new Date(Date.parse(session.ends_at) + EXTRA_TIME_MS).toISOString();
    changes.ends_at = endsAt;
  }
  if (kind === 'skip') changes.answers = { ...session.answers, [questionId]: SKIPPED };

  const { data: updated, error: upErr } = await getDb()
    .from('blitz_sessions')
    .update(changes)
    .eq('id', sessionId)
    .eq('answered_count', session.answered_count)
    .is('finished_at', null)
    .select('id');
  if (upErr || updated.length === 0) {
    await shop.refundItem(playerId, kind);
    if (upErr) throw dbError(upErr, 'blitz.helper.update');
    throw httpError(409, 'No se pudo usar el comodín, inténtalo otra vez');
  }
  return { kind, left, remove, endsAt, extraMs: kind === 'time' ? EXTRA_TIME_MS : 0, skipped: kind === 'skip' };
}

async function finish(sessionId, body, playerId) {
  let session = await loadSession(sessionId, playerId);
  const now = Date.now();

  if (!session.finished_at) {
    const ready = canFinish(
      {
        endsAtMs: Date.parse(session.ends_at),
        answeredCount: Object.keys(session.answers || {}).length,
        totalQuestions: session.question_ids.length,
      },
      now
    );
    if (!ready) throw httpError(409, 'La partida aún no ha terminado');
    const changes = { finished_at: new Date(now).toISOString() };
    // Con puntos, la partida entra en el ranking con el nombre del jugador.
    let playerName = null;
    if (session.player_id && session.score > 0) {
      const { data: p } = await getDb().from('players').select('name').eq('id', session.player_id).maybeSingle();
      playerName = p ? p.name : null;
    }
    if (playerName) changes.player_name = playerName;
    const { data, error } = await getDb().from('blitz_sessions').update(changes).eq('id', sessionId).is('finished_at', null).select('*');
    if (error) throw dbError(error, 'blitz.finish');
    if (data.length) {
      session = data[0];
      if (session.player_id) {
        const { data: prev, error: prevErr } = await getDb()
          .from('blitz_sessions')
          .select('id, score')
          .eq('player_id', session.player_id)
          .not('finished_at', 'is', null)
          .order('score', { ascending: false })
          .limit(2);
        if (prevErr) throw dbError(prevErr, 'blitz.finish.best');
        const previousBest = prev.filter((r) => r.id !== session.id)[0]?.score ?? 0;
        const amount = blitzCoins({ correctCount: session.correct_count, score: session.score, previousBest });
        const coins = await shop.award(session.player_id, amount, 'game:blitz');
        const { data: saved } = await getDb()
          .from('blitz_sessions')
          .update({ coins: coins.awarded + coins.bonus })
          .eq('id', sessionId)
          .select('*');
        if (saved && saved.length) session = saved[0];
        session.coinResult = { ...coins, personalBest: session.score > 0 && session.score > previousBest };
        session.xpResult = await heroes.safeXp(session.player_id, blitzXp(session.correct_count), 'game:blitz');
      }
    } else {
      session = await loadSession(sessionId, playerId);
    }
  }

  let rank = null;
  if (session.player_name) {
    const { count, error } = await getDb()
      .from('blitz_sessions')
      .select('id', { count: 'exact', head: true })
      .not('player_name', 'is', null)
      .gt('score', session.score);
    if (error) throw dbError(error, 'blitz.finish.rank');
    rank = (count ?? 0) + 1;
  }

  return {
    score: session.score,
    correctCount: session.correct_count,
    answeredCount: session.answered_count,
    bestStreak: session.best_streak,
    playerName: session.player_name,
    rank,
    coins: session.coinResult || { awarded: session.coins ?? 0, bonus: 0, balance: null, personalBest: false },
    xp: session.xpResult || null,
  };
}

async function leaderboard({ period = 'week', limit = 20 } = {}) {
  limit = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 20));
  let query = getDb()
    .from('blitz_sessions')
    .select('player_name, player_id, score, correct_count, answered_count, best_streak, finished_at')
    .not('player_name', 'is', null)
    .order('score', { ascending: false })
    .order('finished_at', { ascending: true })
    .limit(limit);
  if (period !== 'all') {
    query = query.gte('finished_at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());
  }
  const { data, error } = await query;
  if (error) throw dbError(error, 'blitz.leaderboard');
  const ids = [...new Set(data.map((r) => r.player_id).filter(Boolean))];
  let avatars = new Map();
  if (ids.length) {
    const { data: ps, error: pErr } = await getDb().from('players').select('id, avatar').in('id', ids);
    if (pErr) throw dbError(pErr, 'blitz.leaderboard.avatars');
    avatars = new Map(ps.map((p) => [p.id, p.avatar]));
  }
  return data.map((r, i) => ({
    rank: i + 1,
    name: r.player_name,
    avatar: avatars.get(r.player_id) || null,
    score: r.score,
    correctCount: r.correct_count,
    answeredCount: r.answered_count,
    bestStreak: r.best_streak,
    finishedAt: r.finished_at,
  }));
}

module.exports = { start, answer, finish, leaderboard, useHelper };
