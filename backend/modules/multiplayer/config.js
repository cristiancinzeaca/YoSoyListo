// Ajustes de las partidas en red. Los tests acortan los tiempos.
const config = {
  duelQuestions: 7,
  roomQuestionOptions: [5, 10, 15],
  roomDefaultQuestions: 10,
  questionMs: 15_000,
  revealMs: 3_500,
  countdownMs: 3_000,
  // Si en este tiempo no aparece rival humano, se juega contra un bot.
  botWaitMs: 12_000,
  // Tiempo para volver tras perder la conexión estando en una sala de espera.
  lobbyGraceMs: 30_000,
  // Las salas terminadas se borran tras este tiempo sin actividad.
  finishedRoomTtlMs: 10 * 60_000,
  maxRoomPlayers: 8,
  maxRooms: 500,
  basePoints: 500,
  speedPoints: 500,
  eloK: 32,
};

module.exports = { config };
