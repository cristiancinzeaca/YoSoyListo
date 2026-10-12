const crypto = require('crypto');

const BOT_NAMES = ['Einstein', 'Curie', 'Cervantes', 'Frida', 'Lorca', 'Hipatia', 'Ramón y Cajal', 'Lovelace'];

function createBot(takenNames = []) {
  const free = BOT_NAMES.filter((n) => !takenNames.includes(`🤖 ${n}`));
  const base = free.length ? free[crypto.randomInt(free.length)] : `Bot ${crypto.randomInt(100)}`;
  return {
    id: `bot-${crypto.randomUUID()}`,
    name: `🤖 ${base}`,
    isBot: true,
    // Probabilidad de acertar: ni imposible de ganar ni demasiado fácil.
    skill: 0.45 + Math.random() * 0.3,
  };
}

// Decide qué contesta un bot y cuánto tarda.
function botMove(bot, question, questionMs) {
  const correct = Math.random() < bot.skill;
  let option = question.correctIndex;
  if (!correct) {
    const wrong = question.options.map((_, i) => i).filter((i) => i !== question.correctIndex);
    option = wrong[crypto.randomInt(wrong.length)];
  }
  const min = Math.min(2_000, questionMs * 0.2);
  const max = questionMs * 0.75;
  return { option, delayMs: Math.round(min + Math.random() * (max - min)) };
}

module.exports = { createBot, botMove };
