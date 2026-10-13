// Preguntas del modo +18 (db/adult). Viven aparte para que nunca salgan en los modos normales.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'db', 'adult');
const CHOICE = JSON.parse(fs.readFileSync(path.join(DIR, 'choice.json'), 'utf8')).map(([text, correct, wrong, category], i) => ({
  id: `x${i}`,
  text,
  correct,
  wrong,
  category: `x18_${category}`,
}));
const NUMERIC = JSON.parse(fs.readFileSync(path.join(DIR, 'numeric.json'), 'utf8')).map(([text, answer, unit, category], i) => ({
  id: `xn${i}`,
  text,
  answer,
  unit,
  category: `x18_${category}`,
}));

function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function loadChoice(count) {
  return shuffled(CHOICE)
    .slice(0, count)
    .map((q) => {
      const options = shuffled([q.correct, ...q.wrong]);
      return { id: q.id, text: q.text, options, correctIndex: options.indexOf(q.correct), category: q.category, explanation: null };
    });
}

async function loadNumeric(count) {
  return shuffled(NUMERIC)
    .slice(0, count)
    .map(({ id, text, answer, unit, category }) => ({ id, text, answer, unit, category }));
}

module.exports = { loadChoice, loadNumeric, CHOICE, NUMERIC };
