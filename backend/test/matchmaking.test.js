const test = require('node:test');
const assert = require('node:assert/strict');
const mm = require('../modules/multiplayer/matchmaking');

const now = 1_000_000;
const e = (id, score, waitedMs) => ({ id, score, since: now - waitedMs });

test('rangos y puntuación', () => {
  assert.equal(mm.matchRating({ rating: 1000, level: 1 }), 1000);
  assert.equal(mm.matchRating({ rating: 1000, level: 11 }), 1050);
  assert.equal(mm.tierOf(850).key, 'bronce');
  assert.equal(mm.tierOf(1000).key, 'plata');
  assert.equal(mm.tierOf(1250).key, 'oro');
  assert.equal(mm.tierOf(1800).key, 'maestro');
});

test('prefiere al rival más parecido', () => {
  const pair = mm.findPair([e('a', 1000, 1000), e('b', 1600, 900), e('c', 1040, 500)], now);
  assert.deepEqual(pair, ['a', 'c']);
});

test('al principio no junta niveles muy distintos; con la espera, sí', () => {
  assert.equal(mm.findPair([e('a', 1000, 0), e('b', 1400, 0)], now), null);
  // 400 de diferencia: con 12 s de espera la ventana es 100 + 12·25 = 400.
  assert.deepEqual(mm.findPair([e('a', 1000, 12_000), e('b', 1400, 0)], now), ['a', 'b']);
});

test('pasado el tiempo, cualquiera vale', () => {
  assert.deepEqual(mm.findPair([e('novata', 800, mm.MM.anyoneAfterMs), e('maestro', 2000, 0)], now), ['novata', 'maestro']);
});

test('grupos de 3 para Conquista: los más parecidos', () => {
  const g = mm.findGroup([e('a', 1000, 3000), e('b', 1900, 2000), e('c', 1050, 1000), e('d', 980, 500)], 3, now);
  assert.deepEqual(g.sort(), ['a', 'c', 'd']);
  assert.equal(mm.findGroup([e('a', 1000, 0), e('b', 1500, 0), e('c', 2000, 0)], 3, now), null);
});

test('bots a la medida', () => {
  assert.ok(mm.botSkillFor(800) < mm.botSkillFor(1500));
  assert.ok(mm.botSkillFor(5000) <= 0.85);
  assert.ok(mm.botSkillFor(0) >= 0.35);
});
