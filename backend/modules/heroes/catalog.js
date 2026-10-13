// Héroes: razas, clases, niveles y equipo. El equipo es solo de imagen (no da ventaja en las preguntas):
// cada pieza cambia cómo se ve el retrato (marco, aura, emblema, estandarte y título) y suma «poder».
// Todo el equipo se consigue subiendo de nivel: al llegar al nivel de una pieza, queda desbloqueada.

const RACES = {
  humano: {
    name: 'Humano',
    lore: 'Hijos de las ciudades de piedra de Hispania. No son los más fuertes ni los más longevos, pero nadie aprende tan rápido como ellos.',
  },
  elfo: {
    name: 'Elfo',
    lore: 'Guardianes de los bosques eternos del norte. Han vivido siglos entre libros vivos y recuerdan lo que los demás olvidan.',
  },
  enano: {
    name: 'Enano',
    lore: 'Forjadores de las montañas de hierro. Cada respuesta correcta la graban en piedra para que dure mil años.',
  },
  orco: {
    name: 'Orco',
    lore: 'Clanes de las estepas rojas. Dicen que son brutos, pero su sabiduría se gana en el campo de batalla… y en los duelos de preguntas.',
  },
};

const CLASSES = {
  guerrero: { name: 'Guerrero', lore: 'Responde sin miedo y ataca de frente. Su escudo es la memoria.' },
  mago: { name: 'Mago', lore: 'Estudia los grimorios del saber. Para él, cada pregunta es un hechizo por descifrar.' },
  explorador: { name: 'Explorador', lore: 'Ha recorrido el mundo y lo ha visto todo. Geografía, historia y costumbres: nada se le escapa.' },
};

// ---------- niveles ----------
const MAX_LEVEL = 50;
// XP para pasar del nivel n al n+1: 100, 150, 200…
const xpToNext = (level) => 100 + 50 * (level - 1);

function levelFromXp(xp) {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp || 0));
  while (level < MAX_LEVEL && rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level += 1;
  }
  return { level, into: rest, next: level < MAX_LEVEL ? xpToNext(level) : 0 };
}

// XP que da cada cosa.
const XP = {
  blitzPerCorrect: 3,
  duel: { win: 40, tie: 25, loss: 15 },
  room: [50, 35, 25, 15],
  conquista: [80, 50, 30],
  botFactor: 0.6,
  countryConquered: 100,
  countryDefended: 20,
};

// ---------- equipo ----------
// slot → qué cambia en el retrato:
//   armadura → el marco · arma → el aura · emblema → la insignia · estandarte → el fondo · título → texto bajo el nombre
const SLOTS = ['armadura', 'arma', 'emblema', 'estandarte', 'titulo'];
const SLOT_NAMES = { armadura: 'Armadura', arma: 'Arma', emblema: 'Emblema', estandarte: 'Estandarte', titulo: 'Título' };

// [id, slot, nombre, nivel, poder]
const ITEMS_LIST = [
  ['cuero', 'armadura', 'Armadura de cuero', 1, 10],
  ['hierro', 'armadura', 'Cota de hierro', 3, 30],
  ['acero', 'armadura', 'Coraza de acero', 7, 70],
  ['plata', 'armadura', 'Armadura de plata', 12, 120],
  ['oro', 'armadura', 'Armadura de oro', 18, 200],
  ['mitril', 'armadura', 'Armadura de mitril', 25, 300],
  ['dragon', 'armadura', 'Escamas de dragón', 35, 450],
  ['celestial', 'armadura', 'Armadura celestial', 50, 700],

  ['ninguna', 'arma', 'Sin aura', 1, 0],
  ['chispa', 'arma', 'Filo chispeante', 5, 50],
  ['llamas', 'arma', 'Hoja de llamas', 10, 100],
  ['escarcha', 'arma', 'Acero de escarcha', 15, 150],
  ['rayo', 'arma', 'Lanza del rayo', 20, 220],
  ['arcano', 'arma', 'Báculo arcano', 28, 320],
  ['sol', 'arma', 'Espada del sol', 40, 500],

  ['ninguno', 'emblema', 'Sin emblema', 1, 0],
  ['bronce', 'emblema', 'Emblema de bronce', 2, 20],
  ['buho', 'emblema', 'Emblema del búho', 9, 80],
  ['corona', 'emblema', 'Emblema de la corona', 16, 160],
  ['dragon_e', 'emblema', 'Emblema del dragón', 30, 350],
  ['estrella', 'emblema', 'Estrella de la sabiduría', 45, 550],

  ['noche', 'estandarte', 'Estandarte nocturno', 1, 0],
  ['bosque', 'estandarte', 'Estandarte del bosque', 6, 40],
  ['volcan', 'estandarte', 'Estandarte del volcán', 14, 120],
  ['oceano', 'estandarte', 'Estandarte del océano', 22, 220],
  ['aurora', 'estandarte', 'Estandarte de la aurora', 33, 380],

  ['novato', 'titulo', 'Novato', 1, 0],
  ['aprendiz', 'titulo', 'Aprendiz', 4, 20],
  ['erudito', 'titulo', 'Erudito', 8, 60],
  ['sabio', 'titulo', 'Sabio', 13, 110],
  ['maestro', 'titulo', 'Maestro del saber', 20, 200],
  ['gran_sabio', 'titulo', 'Gran sabio', 27, 300],
  ['leyenda', 'titulo', 'Leyenda viva', 38, 450],
  ['inmortal', 'titulo', 'Inmortal', 50, 800],
];

// Piezas que solo se consiguen en la campaña (al vencer a un jefe).
const CAMPAIGN_ITEMS = [
  ['heroe_alejandria', 'titulo', 'Héroe de Alejandría', 60],
  ['heroe_bosque', 'titulo', 'Guardián del Bosque', 60],
  ['heroe_forja', 'titulo', 'Señor de la Forja', 60],
  ['heroe_tambor', 'titulo', 'Hijo del Tambor', 60],
  ['biblioteca', 'estandarte', 'Estandarte de la Biblioteca', 150],
  ['marea', 'arma', 'Garfio de la Marea', 200],
  ['reloj', 'emblema', 'Emblema del Tiempo', 200],
  ['mecanica', 'armadura', 'Armadura mecánica', 250],
  ['niebla', 'arma', 'Filo del Olvido', 600],
  ['vencedor', 'titulo', 'Vencedor del Olvido', 500],
];

const ITEMS = Object.fromEntries([
  ...ITEMS_LIST.map(([id, slot, name, level, power]) => [id, { id, slot, name, level, power }]),
  ...CAMPAIGN_ITEMS.map(([id, slot, name, power]) => [id, { id, slot, name, level: 1, power, campaign: true }]),
]);
const DEFAULT_EQUIP = { armadura: 'cuero', arma: 'ninguna', emblema: 'ninguno', estandarte: 'noche', titulo: 'novato' };

// Opciones del juego que se desbloquean por nivel (se irán añadiendo).
const UNLOCKS = [
  { level: 2, key: 'chat_general', name: 'Escribir en el chat General' },
  { level: 3, key: 'chat_privado', name: 'Enviar mensajes privados' },
  { level: 5, key: 'comprar_paises', name: 'Comprar países en «Conquista el mundo»' },
];
const UNLOCK_LEVEL = Object.fromEntries(UNLOCKS.map((u) => [u.key, u.level]));

const itemsAtLevel = (level) => ITEMS_LIST.filter(([, , , l]) => l === level).map(([id]) => ITEMS[id]);

module.exports = {
  RACES,
  CLASSES,
  MAX_LEVEL,
  XP,
  xpToNext,
  levelFromXp,
  SLOTS,
  SLOT_NAMES,
  ITEMS,
  DEFAULT_EQUIP,
  UNLOCKS,
  UNLOCK_LEVEL,
  itemsAtLevel,
};
