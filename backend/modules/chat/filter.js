// Limpieza de los mensajes del chat: tacos, enlaces y datos personales fuera.

const MAX_LENGTH = 200;

// Palabras que se tapan con asteriscos. Las de 6 letras o más también tapan las palabras
// que empiezan por ellas («cabrones», «gilipollass»). Palabras normales que pueden molestar
// («tonto», «perra», «retrasado») se dejan: para eso están «Reportar» y «Bloquear».
const BAD = [
  'puta', 'putas', 'puto', 'putos', 'putita', 'putero', 'hijoputa', 'hdp', 'mierda', 'mierdas', 'polla', 'pollas',
  'coño', 'gilipollas', 'gilipolla', 'cabron', 'cabrona', 'cabrones', 'maricon', 'maricona', 'maricones', 'marica',
  'zorra', 'zorras', 'follar', 'follo', 'folla', 'pene', 'verga', 'joder', 'jodete', 'nazi', 'nazis', 'hitler',
  'subnormal', 'subnormales', 'mongolo', 'mongola', 'malparido', 'malparida', 'pendejo',
  'pendeja', 'culero', 'mamon', 'mamona', 'mamada', 'chupamela', 'pajero', 'pajillero', 'capullo', 'imbecil',
  'imbeciles', 'gordo de mierda', 'negrata', 'sudaca', 'panchito', 'moro de mierda',
  'travelo', 'bollera', 'puton', 'guarra', 'violador', 'matate', 'suicidate',
];

const ROOT_MIN = 6; // a partir de esta longitud, la palabra tapa también lo que empieza por ella

function simplify(word) {
  return word
    .toLowerCase()
    .replace(/ñ/g, 'ny') // «coño» no es «cono»
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/[@]/g, 'a')
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1{2,}/g, '$1$1'); // «puuuuta» → «puuta» (isBad prueba también sin letras dobles)
}

const SINGLE = new Set();
const ROOTS = [];
const PHRASES = [];
for (const w of BAD) {
  const s = simplify(w);
  if (w.includes(' ')) PHRASES.push(w.split(' ').map(simplify));
  else if (s.length >= ROOT_MIN) ROOTS.push(s);
  else SINGLE.add(s);
}

function isBad(word) {
  const s = simplify(word);
  if (!s) return false;
  const squeezed = s.replace(/(.)\1+/g, '$1');
  if (SINGLE.has(s) || SINGLE.has(squeezed)) return true;
  return ROOTS.some((r) => s.startsWith(r) || squeezed.startsWith(r.replace(/(.)\1+/g, '$1')));
}

const stars = (word) => '*'.repeat(Math.min(6, Math.max(3, word.length)));

// Devuelve { text } limpio o { error }.
function cleanMessage(raw) {
  if (typeof raw !== 'string') return { error: 'Escribe un mensaje' };
  let text = raw
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u206f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return { error: 'Escribe un mensaje' };
  if (text.length > MAX_LENGTH) return { error: `Máximo ${MAX_LENGTH} caracteres` };

  // Enlaces, correos y teléfonos: fuera (spam y datos personales).
  text = text
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[enlace]')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[correo]')
    .replace(/\b[a-z0-9-]{2,}\.(?:com|es|net|org|io|gg|ly|me|tv|xyz|info|link|app)\b\S*/gi, '[enlace]')
    .replace(/(?:\+?\d[\s.-]?){7,}/g, ' [número] ')
    .replace(/\s+/g, ' ')
    .trim();

  // Tacos palabra a palabra (y frases de dos palabras).
  const parts = text.split(/(\s+)/);
  for (let i = 0; i < parts.length; i += 2) {
    if (isBad(parts[i])) parts[i] = stars(parts[i]);
  }
  for (const phrase of PHRASES) {
    for (let i = 0; i + 2 * (phrase.length - 1) < parts.length; i += 2) {
      if (phrase.every((w, k) => simplify(parts[i + 2 * k]) === w)) {
        for (let k = 0; k < phrase.length; k++) parts[i + 2 * k] = stars(parts[i + 2 * k]);
      }
    }
  }
  text = parts.join('');
  return { text };
}

module.exports = { cleanMessage, MAX_LENGTH, isBad };
