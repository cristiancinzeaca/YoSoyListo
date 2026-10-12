// Reglas del modo Blitz. Funciones puras: sin base de datos, fáciles de probar.
const { validatePlayerName } = require('../players/names');

const BLITZ = {
  durationMs: 60_000,
  // Margen para respuestas enviadas justo al acabar el tiempo (latencia de red).
  graceMs: 2_000,
  questionsPerGame: 40,
  basePoints: 10,
  // Cada 3 aciertos seguidos sube el multiplicador, hasta x3.
  streakStep: 3,
  maxMultiplier: 3,
};

function multiplierFor(streak) {
  if (streak <= 0) return 1;
  return Math.min(1 + Math.floor((streak - 1) / BLITZ.streakStep), BLITZ.maxMultiplier);
}

function applyAnswer(state, isCorrect) {
  const streak = isCorrect ? state.streak + 1 : 0;
  const multiplier = isCorrect ? multiplierFor(streak) : 1;
  const points = isCorrect ? BLITZ.basePoints * multiplier : 0;
  return {
    score: state.score + points,
    correctCount: state.correctCount + (isCorrect ? 1 : 0),
    answeredCount: state.answeredCount + 1,
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    points,
    multiplier,
  };
}

function acceptsAnswers(endsAtMs, nowMs) {
  return nowMs <= endsAtMs + BLITZ.graceMs;
}

// Se puede cerrar la partida cuando se acaba el tiempo o no quedan preguntas.
function canFinish({ endsAtMs, answeredCount, totalQuestions }, nowMs) {
  return nowMs >= endsAtMs - BLITZ.graceMs || answeredCount >= totalQuestions;
}

module.exports = { BLITZ, multiplierFor, applyAnswer, acceptsAnswers, canFinish, validatePlayerName };
