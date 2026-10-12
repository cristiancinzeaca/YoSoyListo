// Países que se pueden comprar, sus precios y su banco de preguntas (db/countries/<id>.json).
// Las preguntas solo viven en el servidor: el dueño las ve para estudiar; el atacante, nunca las respuestas.
const fs = require('fs');
const path = require('path');

const RULES = {
  incomeRate: 0.05, // 5 % del valor al día
  incomeMaxDays: 3, // lo no cobrado se acumula como mucho 3 días (hay que volver a cobrar)
  attackCost: 100,
  baseQuestions: 10, // las 10 primeras del banco: fijas, el dueño las estudia
  defenseQuestions: 10, // otras 10 que elige el dueño
  fortifyStep: 5, // cada fortificación añade 5 preguntas (cuesta lo mismo que el país)
  questionMs: 12_000, // tiempo por pregunta al atacar (incluye la red)
  graceMs: 1_500,
  attackCooldownMs: 24 * 3600_000, // un mismo jugador solo puede atacar un país una vez al día
  compensation: 0.5, // al perder un país, el dueño cobra el 50 % de su valor
  valueGainOnDefense: 100, // cada ataque fallido sube el valor del país
};

// [id, nombre, bandera, precio]
const LIST = [
  ['ad', 'Andorra', '🇦🇩', 1000],
  ['pt', 'Portugal', '🇵🇹', 2500],
  ['gr', 'Grecia', '🇬🇷', 2500],
  ['ma', 'Marruecos', '🇲🇦', 2500],
  ['co', 'Colombia', '🇨🇴', 3500],
  ['ar', 'Argentina', '🇦🇷', 3500],
  ['eg', 'Egipto', '🇪🇬', 3500],
  ['mx', 'México', '🇲🇽', 5000],
  ['it', 'Italia', '🇮🇹', 5000],
  ['gb', 'Reino Unido', '🇬🇧', 7000],
  ['fr', 'Francia', '🇫🇷', 7000],
  ['de', 'Alemania', '🇩🇪', 7000],
  ['jp', 'Japón', '🇯🇵', 7000],
  ['br', 'Brasil', '🇧🇷', 7000],
  ['es', 'España', '🇪🇸', 10000],
  ['cn', 'China', '🇨🇳', 12000],
  ['us', 'Estados Unidos', '🇺🇸', 15000],
];

const DIR = path.join(__dirname, '..', '..', 'db', 'countries');

// Pregunta → { seq, text, options, correctIndex } con la correcta en posición fija (se baraja al usarla).
function loadBank(id) {
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
  return raw.map(([text, correct, wrong], seq) => ({ seq, text, options: [correct, ...wrong], correctIndex: 0 }));
}

const COUNTRIES = Object.fromEntries(
  LIST.map(([id, name, flag, price]) => [id, { id, name, flag, price, questions: loadBank(id) }])
);

function maxFortify(country) {
  const extra = country.questions.length - RULES.baseQuestions - RULES.defenseQuestions;
  return Math.max(0, Math.floor(extra / RULES.fortifyStep));
}

const defenseSize = (fortify) => RULES.defenseQuestions + fortify * RULES.fortifyStep;

module.exports = { RULES, COUNTRIES, maxFortify, defenseSize };
