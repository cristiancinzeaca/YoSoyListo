// Reglas y tiempos del modo Conquista. Los tests acortan los tiempos.
const CQ = {
  players: 3,
  introMs: 4_000,
  numericMs: 20_000,
  choiceMs: 15_000,
  pickMs: 12_000,
  resultMs: 4_500,
  battleRounds: 3,
  castleValue: 1_000,
  regionValue: 200,
  conquestBonus: 100,
  defenseBonus: 100,
  towers: 3,
  // Si no se juntan 3 personas en este tiempo, se completa con bots.
  botWaitMs: 8_000,
};

module.exports = { CQ };
