const { config } = require('./config');
const { createBot, botMove } = require('./bot');

class GameError extends Error {}

// Una sala de juego: duelo (2 jugadores) o sala privada (hasta 8).
// No sabe nada de WebSockets ni de la base de datos: recibe funciones
// para enviar mensajes, cargar preguntas y guardar el resultado.
class Room {
  constructor({ code, mode, hostId = null, category = null, questionCount, send, loadQuestions, onFinished, onEmpty }) {
    this.code = code;
    this.mode = mode;
    this.hostId = hostId;
    this.category = category;
    this.questionCount = questionCount;
    this.send = send;
    this.loadQuestions = loadQuestions;
    this.onFinished = onFinished;
    this.onEmpty = onEmpty;

    this.players = new Map();
    this.status = 'lobby'; // lobby → starting → question ⇄ reveal → finished
    this.questions = [];
    this.index = -1;
    this.current = null;
    this.lastReveal = null;
    this.result = null;
    this.startedAt = null;
    this.timers = new Set();
    this.lastActivity = Date.now();
    this.destroyed = false;
  }

  // ---------- utilidades ----------
  later(fn, ms) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.destroyed) fn();
    }, ms);
    this.timers.add(timer);
    return timer;
  }

  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  broadcast(msg) {
    for (const p of this.players.values()) {
      if (!p.isBot && p.connected) this.send(p.id, msg);
    }
  }

  humans() {
    return [...this.players.values()].filter((p) => !p.isBot);
  }

  touch() {
    this.lastActivity = Date.now();
  }

  publicState() {
    return {
      code: this.code,
      mode: this.mode,
      status: this.status,
      hostId: this.hostId,
      category: this.category,
      questionCount: this.questionCount,
      index: this.index,
      total: this.questions.length || this.questionCount,
      maxPlayers: this.mode === 'duel' ? 2 : config.maxRoomPlayers,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar || null,
        isBot: p.isBot,
        connected: p.connected,
        score: p.score,
        correctCount: p.correctCount,
        answered: this.status === 'question' && this.current.answers.has(p.id),
      })),
    };
  }

  broadcastState() {
    this.broadcast({ t: 'room', room: this.publicState() });
  }

  questionMessage(forPlayerId) {
    const q = this.questions[this.index];
    const mine = this.current.answers.get(forPlayerId);
    return {
      t: 'question',
      index: this.index,
      total: this.questions.length,
      question: { text: q.text, options: q.options, category: q.category },
      durationMs: config.questionMs,
      timeLeftMs: Math.max(0, this.current.deadline - Date.now()),
      myAnswer: mine ? mine.option : null,
    };
  }

  // Todo lo que necesita un jugador que acaba de (re)conectarse.
  syncPlayer(playerId) {
    this.send(playerId, { t: 'room', room: this.publicState() });
    if (this.status === 'question') this.send(playerId, this.questionMessage(playerId));
    else if (this.status === 'reveal' && this.lastReveal) this.send(playerId, this.lastReveal);
    else if (this.status === 'finished' && this.result) this.send(playerId, this.result);
  }

  // ---------- jugadores ----------
  addPlayer(player) {
    if (this.players.has(player.id)) {
      this.setConnected(player.id, true);
      return;
    }
    if (this.status !== 'lobby') throw new GameError('La partida ya ha empezado');
    const max = this.mode === 'duel' ? 2 : config.maxRoomPlayers;
    if (this.players.size >= max) throw new GameError('La sala está llena');
    this.players.set(player.id, {
      id: player.id,
      name: player.name,
      avatar: player.avatar || null,
      rating: player.rating ?? null,
      isBot: !!player.isBot,
      skill: player.skill,
      connected: true,
      score: 0,
      correctCount: 0,
    });
    if (!this.hostId && !player.isBot) this.hostId = player.id;
    this.touch();
    this.broadcastState();
  }

  addBot(byId) {
    this.requireHost(byId);
    if (this.status !== 'lobby') throw new GameError('La partida ya ha empezado');
    const bot = createBot([...this.players.values()].map((p) => p.name));
    this.addPlayer(bot);
  }

  removeBot(byId, botId) {
    this.requireHost(byId);
    const p = this.players.get(botId);
    if (this.status !== 'lobby' || !p || !p.isBot) return;
    this.players.delete(botId);
    this.broadcastState();
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.status === 'lobby' || this.status === 'finished') {
      this.players.delete(id);
    } else {
      // En plena partida se queda en la clasificación, pero ya no juega.
      p.connected = false;
      p.left = true;
    }
    if (this.hostId === id) {
      const next = this.humans().find((h) => h.connected && !h.left);
      this.hostId = next ? next.id : null;
    }
    this.touch();
    this.checkEmpty();
    if (this.destroyed) return;
    this.broadcastState();
    if (this.status === 'question') this.maybeRevealEarly();
  }

  setConnected(id, connected) {
    const p = this.players.get(id);
    if (!p || p.isBot) return;
    p.connected = connected;
    if (connected) p.left = false;
    this.touch();
    if (!connected) {
      if (this.status === 'lobby') {
        this.later(() => {
          const again = this.players.get(id);
          if (again && !again.connected) this.removePlayer(id);
        }, config.lobbyGraceMs);
      }
      this.checkEmpty();
      if (this.destroyed) return;
      this.broadcastState();
      if (this.status === 'question') this.maybeRevealEarly();
      return;
    }
    this.broadcastState();
  }

  checkEmpty() {
    const someoneHere = this.humans().some((h) => h.connected);
    const anyone = this.humans().length > 0;
    // Sin humanos conectados durante la partida, o sala vacía: se cierra.
    if (!anyone || (!someoneHere && this.status !== 'lobby')) this.destroy();
  }

  requireHost(byId) {
    if (this.hostId !== byId) throw new GameError('Solo el anfitrión puede hacer eso');
  }

  updateSettings(byId, { category, questionCount }) {
    this.requireHost(byId);
    if (this.status !== 'lobby') throw new GameError('La partida ya ha empezado');
    if (category !== undefined) this.category = category || null;
    if (questionCount !== undefined) {
      const n = Number(questionCount);
      if (!config.roomQuestionOptions.includes(n)) throw new GameError('Número de preguntas no válido');
      this.questionCount = n;
    }
    this.broadcastState();
  }

  // ---------- partida ----------
  async start(byId) {
    if (byId !== undefined) this.requireHost(byId);
    if (this.status !== 'lobby') throw new GameError('La partida ya ha empezado');
    if (this.players.size < 2) throw new GameError('Hacen falta al menos 2 jugadores');

    this.status = 'starting';
    this.broadcastState();
    let questions;
    try {
      questions = await this.loadQuestions(this.questionCount, this.category);
    } catch (err) {
      this.status = 'lobby';
      this.broadcastState();
      throw err;
    }
    if (this.destroyed) return;
    if (questions.length === 0) {
      this.status = 'lobby';
      this.broadcastState();
      throw new GameError('No hay preguntas en esa categoría');
    }
    this.questions = questions;
    this.startedAt = new Date();
    for (const p of this.players.values()) {
      p.score = 0;
      p.correctCount = 0;
    }
    this.index = -1;
    this.broadcast({ t: 'countdown', ms: config.countdownMs });
    this.later(() => this.nextQuestion(), config.countdownMs);
  }

  nextQuestion() {
    this.index += 1;
    if (this.index >= this.questions.length) return this.finish();
    const now = Date.now();
    this.status = 'question';
    this.current = { startedAt: now, deadline: now + config.questionMs, answers: new Map(), helpers: new Map() };
    this.lastReveal = null;
    for (const p of this.players.values()) {
      if (!p.isBot && p.connected) this.send(p.id, this.questionMessage(p.id));
    }
    this.broadcastState();

    const q = this.questions[this.index];
    const index = this.index;
    for (const p of this.players.values()) {
      if (!p.isBot) continue;
      const move = botMove(p, q, config.questionMs);
      this.later(() => {
        if (this.status === 'question' && this.index === index) this.answer(p.id, index, move.option);
      }, move.delayMs);
    }
    this.current.timer = this.later(() => this.reveal(), config.questionMs);
  }

  answer(playerId, index, option) {
    const p = this.players.get(playerId);
    if (!p || p.left) return;
    if (this.status !== 'question' || index !== this.index) return;
    if (this.current.answers.has(playerId)) return;
    const q = this.questions[this.index];
    if (!Number.isInteger(option) || option < 0 || option >= q.options.length) return;

    const now = Date.now();
    const timeLeft = Math.max(0, this.current.deadline - now);
    const correct = option === q.correctIndex;
    const points = correct ? Math.round(config.basePoints + (config.speedPoints * timeLeft) / config.questionMs) : 0;
    this.current.answers.set(playerId, { option, correct, points });
    this.touch();
    this.broadcast({ t: 'answered', playerId });
    this.maybeRevealEarly();
  }

  // Comodín pedido por un jugador. Reserva el uso (una vez por pregunta) y devuelve lo que verá;
  // si luego no tenía el comodín, se llama a cancel().
  helperOffer(playerId, kind) {
    if (kind !== 'fifty') throw new GameError('Ese comodín solo se puede usar en el Blitz');
    const p = this.players.get(playerId);
    if (!p || p.left || this.status !== 'question') throw new GameError('Ahora no se puede usar un comodín');
    if (this.current.answers.has(playerId)) throw new GameError('Ya has respondido');
    const used = this.current.helpers.get(playerId) || new Set();
    if (used.has(kind)) throw new GameError('Ya has usado ese comodín en esta pregunta');
    used.add(kind);
    this.current.helpers.set(playerId, used);
    const q = this.questions[this.index];
    const wrong = q.options.map((_, i) => i).filter((i) => i !== q.correctIndex);
    for (let i = wrong.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [wrong[i], wrong[j]] = [wrong[j], wrong[i]];
    }
    const current = this.current;
    return {
      payload: { index: this.index, remove: wrong.slice(0, Math.max(0, q.options.length - 2)).sort() },
      cancel: () => current.helpers.get(playerId)?.delete(kind),
    };
  }

  maybeRevealEarly() {
    const waiting = [...this.players.values()].filter(
      (p) => (p.isBot || (p.connected && !p.left)) && !this.current.answers.has(p.id)
    );
    if (waiting.length === 0) {
      clearTimeout(this.current.timer);
      this.timers.delete(this.current.timer);
      this.reveal();
    }
  }

  reveal() {
    if (this.status !== 'question') return;
    this.status = 'reveal';
    const q = this.questions[this.index];
    const results = [];
    for (const p of this.players.values()) {
      const a = this.current.answers.get(p.id);
      if (a && a.correct) {
        p.score += a.points;
        p.correctCount += 1;
      }
      results.push({
        playerId: p.id,
        option: a ? a.option : null,
        correct: !!(a && a.correct),
        points: a ? a.points : 0,
        score: p.score,
      });
    }
    this.lastReveal = {
      t: 'reveal',
      index: this.index,
      total: this.questions.length,
      questionId: q.id,
      correctIndex: q.correctIndex,
      explanation: q.explanation || null,
      results,
    };
    this.broadcast(this.lastReveal);
    this.broadcastState();
    this.later(() => this.nextQuestion(), config.revealMs);
  }

  ranking() {
    const sorted = [...this.players.values()].sort(
      (a, b) => b.score - a.score || b.correctCount - a.correctCount
    );
    let position = 0;
    return sorted.map((p, i) => {
      const prev = sorted[i - 1];
      if (!prev || prev.score !== p.score || prev.correctCount !== p.correctCount) position = i + 1;
      return {
        playerId: p.id,
        name: p.name,
        avatar: p.avatar || null,
        isBot: p.isBot,
        left: !!p.left,
        score: p.score,
        correctCount: p.correctCount,
        position,
        ratingBefore: null,
        ratingAfter: null,
      };
    });
  }

  async finish() {
    this.status = 'finished';
    this.current = null;
    let ranking = this.ranking();
    try {
      ranking = (await this.onFinished(this, ranking)) || ranking;
    } catch (err) {
      console.error('[multiplayer] no se pudo guardar la partida', err);
    }
    if (this.destroyed) return;
    this.result = { t: 'end', mode: this.mode, ranking, total: this.questions.length };
    this.broadcast(this.result);
    this.broadcastState();
    this.touch();
  }

  // Sala privada: volver a la sala de espera con los mismos jugadores.
  rematch(byId) {
    this.requireHost(byId);
    if (this.mode !== 'room' || this.status !== 'finished') throw new GameError('No se puede repetir ahora');
    for (const [id, p] of this.players) {
      if (!p.isBot && (!p.connected || p.left)) this.players.delete(id);
      p.score = 0;
      p.correctCount = 0;
    }
    this.status = 'lobby';
    this.questions = [];
    this.index = -1;
    this.result = null;
    this.lastReveal = null;
    this.touch();
    this.broadcastState();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearTimers();
    this.onEmpty(this);
  }
}

module.exports = { Room, GameError };
