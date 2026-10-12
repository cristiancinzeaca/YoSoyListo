const { getDb, dbError } = require('../../core/db');
const { httpError } = require('../../core/http');
const { normalizeCategory } = require('../questions/validate');
const { BLITZ, applyAnswer, acceptsAnswers, canFinish, validatePlayerName } = require('./logic');

async function loadSession(id) {
  const { data, error } = await getDb().from('blitz_sessions').select('*').eq('id', id).maybeSingle();
  if (error) throw dbError(error, 'blitz.loadSession');
  if (!data) throw httpError(404, 'Partida no encontrada');
  return data;
}

async function start({ category } = {}) {
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

async function answer(sessionId, { questionId, optionIndex } = {}) {
  const session = await loadSession(sessionId);
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

async function finish(sessionId, { name } = {}) {
  let session = await loadSession(sessionId);
  const now = Date.now();

  let playerName;
  if (name !== undefined && name !== null && name !== '') {
    const { value, error } = validatePlayerName(name);
    if (error) throw httpError(400, error);
    if (session.player_name) throw httpError(409, 'Esta partida ya tiene nombre');
    playerName = value;
  }

  const changes = {};
  if (!session.finished_at) {
    const ready = canFinish(
      {
        endsAtMs: Date.parse(session.ends_at),
        answeredCount: session.answered_count,
        totalQuestions: session.question_ids.length,
      },
      now
    );
    if (!ready) throw httpError(409, 'La partida aún no ha terminado');
    changes.finished_at = new Date(now).toISOString();
  }
  if (playerName) changes.player_name = playerName;

  if (Object.keys(changes).length > 0) {
    let query = getDb().from('blitz_sessions').update(changes).eq('id', sessionId);
    if (playerName) query = query.is('player_name', null);
    const { data, error } = await query.select('*');
    if (error) throw dbError(error, 'blitz.finish');
    if (data.length === 0) throw httpError(409, 'Esta partida ya tiene nombre');
    session = data[0];
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
  };
}

async function leaderboard({ period = 'week', limit = 20 } = {}) {
  limit = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 20));
  let query = getDb()
    .from('blitz_sessions')
    .select('player_name, score, correct_count, answered_count, best_streak, finished_at')
    .not('player_name', 'is', null)
    .order('score', { ascending: false })
    .order('finished_at', { ascending: true })
    .limit(limit);
  if (period !== 'all') {
    query = query.gte('finished_at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());
  }
  const { data, error } = await query;
  if (error) throw dbError(error, 'blitz.leaderboard');
  return data.map((r, i) => ({
    rank: i + 1,
    name: r.player_name,
    score: r.score,
    correctCount: r.correct_count,
    answeredCount: r.answered_count,
    bestStreak: r.best_streak,
    finishedAt: r.finished_at,
  }));
}

module.exports = { start, answer, finish, leaderboard };
