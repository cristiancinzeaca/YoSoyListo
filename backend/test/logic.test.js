const test = require('node:test');
const assert = require('node:assert/strict');
const { BLITZ, multiplierFor, applyAnswer, acceptsAnswers, canFinish, validatePlayerName } = require('../modules/game-blitz/logic');

const empty = { score: 0, correctCount: 0, answeredCount: 0, streak: 0, bestStreak: 0 };

test('el multiplicador sube cada 3 aciertos seguidos y se queda en x3', () => {
  assert.deepEqual([1, 2, 3, 4, 6, 7, 20].map(multiplierFor), [1, 1, 1, 2, 2, 3, 3]);
});

test('una racha de aciertos suma con multiplicador', () => {
  let s = empty;
  for (let i = 0; i < 7; i++) s = applyAnswer(s, true);
  // 3×10 + 3×20 + 1×30
  assert.equal(s.score, 120);
  assert.equal(s.streak, 7);
  assert.equal(s.bestStreak, 7);
  assert.equal(s.correctCount, 7);
});

test('un fallo rompe la racha pero no resta puntos', () => {
  let s = applyAnswer(applyAnswer(empty, true), true);
  s = applyAnswer(s, false);
  assert.equal(s.score, 20);
  assert.equal(s.streak, 0);
  assert.equal(s.bestStreak, 2);
  assert.equal(s.answeredCount, 3);
  assert.equal(s.points, 0);
});

test('se aceptan respuestas hasta el final más el margen', () => {
  const end = 1_000_000;
  assert.equal(acceptsAnswers(end, end), true);
  assert.equal(acceptsAnswers(end, end + BLITZ.graceMs), true);
  assert.equal(acceptsAnswers(end, end + BLITZ.graceMs + 1), false);
});

test('solo se puede terminar al acabar el tiempo o las preguntas', () => {
  const endsAtMs = 1_000_000;
  assert.equal(canFinish({ endsAtMs, answeredCount: 3, totalQuestions: 40 }, endsAtMs - 30_000), false);
  assert.equal(canFinish({ endsAtMs, answeredCount: 3, totalQuestions: 40 }, endsAtMs - 1_000), true);
  assert.equal(canFinish({ endsAtMs, answeredCount: 40, totalQuestions: 40 }, endsAtMs - 30_000), true);
});

test('nombres de jugador', () => {
  assert.equal(validatePlayerName('  María   José ').value, 'María José');
  assert.equal(validatePlayerName('Ñoño_99').value, 'Ñoño_99');
  assert.ok(validatePlayerName('a').error);
  assert.ok(validatePlayerName('x'.repeat(21)).error);
  assert.ok(validatePlayerName('<script>').error);
  assert.ok(validatePlayerName(42).error);
});
