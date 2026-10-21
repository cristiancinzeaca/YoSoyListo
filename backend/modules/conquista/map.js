// Mapa de España por comunidades autónomas (generado a partir de datos del IGN).
const path = require('path');
const map = require(path.join(__dirname, '..', '..', 'public', 'map', 'espana.json'));

const REGIONS = map.regions.map((r) => r.id);
const NAMES = Object.fromEntries(map.regions.map((r) => [r.id, r.name]));
// Nombres en inglés (para la versión internacional).
const EN = {
  andalucia: 'Andalusia', aragon: 'Aragon', asturias: 'Asturias', baleares: 'Balearic Islands', canarias: 'Canary Islands',
  cantabria: 'Cantabria', 'castilla-leon': 'Castile and León', 'castilla-la-mancha': 'Castilla-La Mancha', cataluna: 'Catalonia',
  valencia: 'Valencia', extremadura: 'Extremadura', galicia: 'Galicia', madrid: 'Madrid', murcia: 'Murcia', navarra: 'Navarre',
  'pais-vasco': 'Basque Country', 'la-rioja': 'La Rioja', ceuta: 'Ceuta', melilla: 'Melilla',
};
const NAMES_EN = Object.fromEntries(map.regions.map((r) => [r.id, EN[r.id] || r.name]));
const ADJ = Object.fromEntries(map.regions.map((r) => [r.id, r.adj]));

// Castillos iniciales: tríos de comunidades alejadas entre sí.
const CASTLE_SETS = [
  ['galicia', 'cataluna', 'andalucia'],
  ['asturias', 'valencia', 'extremadura'],
  ['pais-vasco', 'extremadura', 'murcia'],
  ['galicia', 'aragon', 'murcia'],
  ['castilla-leon', 'cataluna', 'andalucia'],
];

module.exports = { REGIONS, NAMES, NAMES_EN, ADJ, CASTLE_SETS };
