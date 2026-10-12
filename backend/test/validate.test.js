const test = require('node:test');
const assert = require('node:assert/strict');
const { validateQuestion, normalizeCategory } = require('../modules/questions/validate');

const base = { text: '¿Capital de Francia?', options: ['París', 'Roma', 'Berlín'], correctIndex: 0 };

test('pregunta válida con valores por defecto', () => {
  const { value, error } = validateQuestion(base);
  assert.equal(error, undefined);
  assert.deepEqual(value, { ...base, category: 'general', difficulty: 2, explanation: null, active: true });
});

test('normaliza la categoría', () => {
  assert.equal(normalizeCategory(' Geografía '), 'geografia');
  assert.equal(normalizeCategory('Arte y Literatura'), 'arte-y-literatura');
  assert.equal(normalizeCategory(''), 'general');
});

test('rechaza preguntas incorrectas', () => {
  const cases = [
    { ...base, text: 'ab' },
    { ...base, options: ['solo una'] },
    { ...base, options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
    { ...base, options: ['París', 'parís'] },
    { ...base, options: ['París', ''] },
    { ...base, correctIndex: 3 },
    { ...base, correctIndex: -1 },
    { ...base, correctIndex: '1.5' },
    { ...base, difficulty: 5 },
    { ...base, explanation: 12 },
    null,
  ];
  for (const c of cases) assert.ok(validateQuestion(c).error, JSON.stringify(c));
});
