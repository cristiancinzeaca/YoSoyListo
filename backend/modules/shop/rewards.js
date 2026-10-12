// Cuántas monedas da cada partida. Funciones puras, fáciles de probar.
const { COINS } = require('./catalog');

function byPosition(table, position) {
  return table[Math.min(position, table.length) - 1];
}

function blitzCoins({ correctCount, score, previousBest }) {
  let coins = correctCount * COINS.blitzPerCorrect;
  if (score > 0 && score > (previousBest ?? 0)) coins += COINS.blitzPersonalBest;
  return coins;
}

// ranking: filas con position (1 = primero). Devuelve las monedas de cada persona.
function matchCoins(mode, row, ranking) {
  const vsBot = ranking.some((r) => r.isBot);
  let coins;
  if (mode === 'duel') {
    const winners = ranking.filter((r) => r.position === 1).length;
    coins = row.position === 1 ? (winners > 1 ? COINS.duel.tie : COINS.duel.win) : COINS.duel.loss;
  } else if (mode === 'room') {
    coins = byPosition(COINS.room, row.position);
  } else {
    coins = byPosition(COINS.conquista, row.position);
  }
  // Quien abandona la partida no cobra.
  if (row.left) return 0;
  if (vsBot && mode !== 'conquista') coins = Math.round(coins * COINS.botFactor);
  return coins;
}

module.exports = { blitzCoins, matchCoins };
