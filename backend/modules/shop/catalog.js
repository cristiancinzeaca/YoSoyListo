// Catálogo de la tienda y reglas de las monedas. Todo lo que se puede ajustar está aquí.

// Comodines: se compran de uno en uno y se gastan al usarlos (máximo uno de cada tipo por pregunta).
const HELPERS = {
  fifty: { name: '50/50', icon: '✂️', price: 40, description: 'Quita dos respuestas incorrectas.', modes: ['blitz', 'duel', 'room', 'conquista'] },
  time: { name: 'Tiempo extra', icon: '⏱️', price: 30, description: '+10 segundos en el Blitz.', modes: ['blitz'] },
  skip: { name: 'Saltar', icon: '⏭️', price: 25, description: 'Pasa a la siguiente pregunta sin perder la racha (Blitz).', modes: ['blitz'] },
  hint: { name: 'Pista', icon: '💡', price: 40, description: 'Te da un intervalo con la respuesta en las preguntas de aproximación (Conquista).', modes: ['conquista'] },
};

// Avatares: precio 0 = gratis para todos.
const AVATARS = {
  buho: { name: 'Búho sabio', price: 0 },
  zorro: { name: 'Zorra científica', price: 0 },
  gato: { name: 'Gato escritor', price: 0 },
  loro: { name: 'Loro artista', price: 0 },
  toro: { name: 'Torito músico', price: 150 },
  tortuga: { name: 'Tortuga astrónoma', price: 150 },
  erizo: { name: 'Erizo investigador', price: 200 },
  mapache: { name: 'Mapache inventor', price: 200 },
};

const FREE_AVATARS = Object.keys(AVATARS).filter((k) => AVATARS[k].price === 0);

const COINS = {
  // Al crear la cuenta.
  welcome: 100,
  welcomeItems: { fifty: 1, time: 1, skip: 1, hint: 1 },
  // Tope de monedas ganadas en partidas por día (hora de Madrid) y bonus de la primera partida del día.
  dailyCap: 500,
  dailyBonus: 20,
  // Blitz: por cada acierto, y extra si es tu mejor marca.
  blitzPerCorrect: 1,
  blitzPersonalBest: 10,
  // Duelo: ganar / empatar / perder.
  duel: { win: 25, tie: 15, loss: 8 },
  // Sala privada y Conquista: por puesto (el resto, el último valor).
  room: [30, 18, 10, 5],
  conquista: [50, 25, 10],
  // En duelos y salas contra bots se gana menos.
  botFactor: 0.6,
  // Cambiar de nombre (los cambios solo de mayúsculas o acentos son gratis).
  rename: 100,
};

const avatarItem = (key) => `avatar:${key}`;

module.exports = { HELPERS, AVATARS, FREE_AVATARS, COINS, avatarItem };
