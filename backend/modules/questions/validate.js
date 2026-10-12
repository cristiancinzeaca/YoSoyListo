const LIMITS = {
  textMin: 5,
  textMax: 500,
  optionsMin: 2,
  optionsMax: 6,
  optionMax: 200,
  categoryMax: 40,
  explanationMax: 1000,
};

function normalizeCategory(value) {
  if (value === undefined || value === null || String(value).trim() === '') return 'general';
  return String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Valida una pregunta en formato API (camelCase). Devuelve { value } o { error }.
function validateQuestion(input) {
  if (!input || typeof input !== 'object') return { error: 'La pregunta debe ser un objeto' };

  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (text.length < LIMITS.textMin || text.length > LIMITS.textMax) {
    return { error: `El texto debe tener entre ${LIMITS.textMin} y ${LIMITS.textMax} caracteres` };
  }

  if (!Array.isArray(input.options)) return { error: 'Las opciones deben ser una lista' };
  const options = input.options.map((o) => (typeof o === 'string' ? o.trim() : ''));
  if (options.length < LIMITS.optionsMin || options.length > LIMITS.optionsMax) {
    return { error: `Debe haber entre ${LIMITS.optionsMin} y ${LIMITS.optionsMax} opciones` };
  }
  if (options.some((o) => o.length === 0 || o.length > LIMITS.optionMax)) {
    return { error: `Cada opción debe tener entre 1 y ${LIMITS.optionMax} caracteres` };
  }
  const lower = options.map((o) => o.toLowerCase());
  if (new Set(lower).size !== lower.length) return { error: 'Hay opciones repetidas' };

  const correctIndex = Number(input.correctIndex);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
    return { error: 'correctIndex debe señalar una de las opciones' };
  }

  const category = normalizeCategory(input.category);
  if (!category || category.length > LIMITS.categoryMax) return { error: 'Categoría no válida' };

  const difficulty = input.difficulty === undefined ? 2 : Number(input.difficulty);
  if (![1, 2, 3].includes(difficulty)) return { error: 'La dificultad debe ser 1, 2 o 3' };

  let explanation = null;
  if (input.explanation !== undefined && input.explanation !== null) {
    if (typeof input.explanation !== 'string') return { error: 'La explicación debe ser texto' };
    explanation = input.explanation.trim() || null;
    if (explanation && explanation.length > LIMITS.explanationMax) {
      return { error: `La explicación no puede pasar de ${LIMITS.explanationMax} caracteres` };
    }
  }

  const active = input.active === undefined ? true : input.active === true;

  return { value: { text, options, correctIndex, category, difficulty, explanation, active } };
}

function toDb(q) {
  return {
    text: q.text,
    options: q.options,
    correct_index: q.correctIndex,
    category: q.category,
    difficulty: q.difficulty,
    explanation: q.explanation,
    active: q.active,
  };
}

function fromDb(row) {
  return {
    id: row.id,
    text: row.text,
    options: row.options,
    correctIndex: row.correct_index,
    category: row.category,
    difficulty: row.difficulty,
    explanation: row.explanation,
    active: row.active,
    createdAt: row.created_at,
  };
}

module.exports = { LIMITS, normalizeCategory, validateQuestion, toDb, fromDb };
