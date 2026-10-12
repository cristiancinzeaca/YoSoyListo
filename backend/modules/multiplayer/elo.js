const { config } = require('./config');

function expectedScore(rating, opponentRating) {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

// result: 1 gana A, 0 gana B, 0.5 empate. Devuelve las nuevas puntuaciones.
function eloUpdate(ratingA, ratingB, result, k = config.eloK) {
  const a = Math.round(ratingA + k * (result - expectedScore(ratingA, ratingB)));
  const b = Math.round(ratingB + k * (1 - result - expectedScore(ratingB, ratingA)));
  return [Math.max(100, a), Math.max(100, b)];
}

module.exports = { expectedScore, eloUpdate };
