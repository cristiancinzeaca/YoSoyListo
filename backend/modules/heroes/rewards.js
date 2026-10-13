// Cuánta experiencia da cada partida (funciones puras).
const { XP } = require('./catalog');

const byPosition = (table, position) => table[Math.min(position, table.length) - 1];

function matchXp(mode, row, ranking) {
  if (row.left) return 0;
  let xp;
  if (mode === 'duel') {
    const winners = ranking.filter((r) => r.position === 1).length;
    xp = row.position === 1 ? (winners > 1 ? XP.duel.tie : XP.duel.win) : XP.duel.loss;
  } else if (mode === 'room') {
    xp = byPosition(XP.room, row.position);
  } else {
    xp = byPosition(XP.conquista, row.position);
  }
  if (ranking.some((r) => r.isBot) && mode !== 'conquista') xp = Math.round(xp * XP.botFactor);
  return xp;
}

const blitzXp = (correctCount) => Math.max(0, correctCount || 0) * XP.blitzPerCorrect;

module.exports = { matchXp, blitzXp };
