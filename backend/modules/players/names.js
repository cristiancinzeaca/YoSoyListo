// Validación de nombres de jugador (perfil, Blitz y partidas en red).

const NAME_RE = /^[\p{L}\p{N} _.-]{2,20}$/u;

// Lista corta de palabras que no queremos ver en el ranking público.
const BLOCKED = [
  'puta', 'puto', 'mierda', 'polla', 'cono', 'gilipollas', 'cabron', 'maricon', 'zorra',
  'follar', 'pene', 'verga', 'joder', 'nazi', 'hitler', 'subnormal', 'retrasado', 'putin',
];

function simplify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/[^a-zñ]/g, '');
}

function validatePlayerName(name) {
  if (typeof name !== 'string') return { error: 'Escribe un nombre' };
  const value = name.trim().replace(/\s+/g, ' ');
  if (!NAME_RE.test(value)) {
    return { error: 'El nombre debe tener entre 2 y 20 letras, números, espacios, puntos o guiones' };
  }
  const simple = simplify(value);
  if (BLOCKED.some((word) => simple.includes(word))) return { error: 'Ese nombre no está permitido' };
  if (/^bot\b/i.test(value)) return { error: 'Ese nombre está reservado' };
  return { value };
}

module.exports = { validatePlayerName };
