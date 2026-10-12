// Mapa de España por comunidades autónomas (generado a partir de datos del IGN).
const path = require('path');
const map = require(path.join(__dirname, '..', '..', 'public', 'map', 'espana.json'));

const REGIONS = map.regions.map((r) => r.id);
const NAMES = Object.fromEntries(map.regions.map((r) => [r.id, r.name]));
const ADJ = Object.fromEntries(map.regions.map((r) => [r.id, r.adj]));

// Castillos iniciales: tríos de comunidades alejadas entre sí.
const CASTLE_SETS = [
  ['galicia', 'cataluna', 'andalucia'],
  ['asturias', 'valencia', 'extremadura'],
  ['pais-vasco', 'extremadura', 'murcia'],
  ['galicia', 'aragon', 'murcia'],
  ['castilla-leon', 'cataluna', 'andalucia'],
];

module.exports = { REGIONS, NAMES, ADJ, CASTLE_SETS };
