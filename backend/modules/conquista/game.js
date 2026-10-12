const crypto = require('crypto');
const { CQ } = require('./config');
const { REGIONS, NAMES, ADJ, CASTLE_SETS } = require('./map');

const COLORS = ['#e5484d', '#3e8ef7', '#2fbf71'];

class Cancelled extends Error {}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom(list) {
  return list[crypto.randomInt(list.length)];
}

function gaussian() {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

// Partida del modo Conquista (estilo Honfoglaló / Conquistador) para 3 jugadores.
// Igual que Room, no sabe nada de WebSockets ni de la base de datos.
class ConquistaGame {
  constructor({ code, players, send, loadNumeric, loadChoice, onFinished, onEmpty }) {
    this.code = code;
    this.mode = 'conquista';
    this.send = send;
    this.loadNumeric = loadNumeric;
    this.loadChoice = loadChoice;
    this.onFinished = onFinished;
    this.onEmpty = onEmpty;

    this.players = players.map((p, i) => ({
      id: p.id,
      name: p.name,
      isBot: !!p.isBot,
      skill: p.skill ?? 0.6,
      color: COLORS[i],
      connected: true,
      left: false,
      eliminated: false,
      bonus: 0,
      castle: null,
      towers: CQ.towers,
    }));
    this.owner = Object.fromEntries(REGIONS.map((r) => [r, null]));
    this.value = Object.fromEntries(REGIONS.map((r) => [r, 0]));

    this.status = 'playing';
    this.phase = 'intro';
    this.round = 0;
    this.timers = new Set();
    this.pending = null;
    this.view = {};
    this.event = null;
    this.result = null;
    this.numericPool = [];
    this.choicePool = [];
    this.startedAt = new Date();
    this.lastActivity = Date.now();
    this.destroyed = false;
  }

  // ---------- utilidades ----------
  player(id) {
    return this.players.find((p) => p.id === id);
  }

  active() {
    return this.players.filter((p) => !p.eliminated);
  }

  regionsOf(id) {
    return REGIONS.filter((r) => this.owner[r] === id);
  }

  score(p) {
    return this.regionsOf(p.id).reduce((sum, r) => sum + this.value[r], 0) + p.bonus;
  }

  later(fn, ms) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.destroyed) fn();
    }, ms);
    this.timers.add(t);
    return t;
  }

  wait(ms) {
    // Si la partida se destruye, el temporizador se cancela y la espera no termina nunca.
    return new Promise((resolve) => this.later(resolve, ms));
  }

  // ---------- estado que ven los jugadores ----------
  stateFor(playerId) {
    const pending = this.pending;
    const mine = pending && pending.answers.get(playerId);
    return {
      t: 'cq_state',
      code: this.code,
      you: playerId,
      phase: this.phase,
      round: this.round,
      rounds: CQ.battleRounds,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        color: p.color,
        connected: p.connected,
        left: p.left,
        eliminated: p.eliminated,
        castle: p.castle,
        towers: p.towers,
        score: this.score(p),
      })),
      owner: this.owner,
      value: this.value,
      timeLeftMs: pending ? Math.max(0, pending.deadline - Date.now()) : 0,
      durationMs: pending ? pending.durationMs : 0,
      participants: pending ? pending.participants : [],
      answered: pending ? [...pending.answers.keys()] : [],
      myAnswer: mine ? mine.value : null,
      ...this.view,
      event: this.event,
      result: this.result,
    };
  }

  broadcast() {
    for (const p of this.players) {
      if (!p.isBot && p.connected) this.send(p.id, this.stateFor(p.id));
    }
  }

  syncPlayer(playerId) {
    this.send(playerId, this.stateFor(playerId));
  }

  setPhase(phase, view = {}, { result = null } = {}) {
    this.phase = phase;
    this.view = view;
    this.result = result;
    this.lastActivity = Date.now();
    this.broadcast();
  }

  // ---------- respuestas ----------
  // Espera a que respondan los participantes (o a que se acabe el tiempo).
  collect(participants, durationMs, { botAnswer } = {}) {
    return new Promise((resolve, reject) => {
      const answers = new Map();
      const deadline = Date.now() + durationMs;
      const pending = { participants, answers, deadline, durationMs, resolve, reject };
      this.pending = pending;
      const finish = () => {
        if (this.pending !== pending) return;
        clearTimeout(pending.timer);
        this.timers.delete(pending.timer);
        this.pending = null;
        resolve(answers);
      };
      pending.finish = finish;
      pending.timer = this.later(finish, durationMs);
      for (const id of participants) {
        const p = this.player(id);
        if (p.isBot && botAnswer) {
          const { value, delayMs } = botAnswer(p);
          this.later(() => this.submit(id, value), Math.min(delayMs, durationMs - 300));
        }
      }
      this.broadcast();
      this.checkComplete();
    });
  }

  canAnswer(id) {
    const p = this.player(id);
    return p.isBot || (p.connected && !p.left);
  }

  checkComplete() {
    const pending = this.pending;
    if (!pending) return;
    const waiting = pending.participants.filter((id) => this.canAnswer(id) && !pending.answers.has(id));
    if (waiting.length === 0) {
      // Pequeña pausa para que se vea la última respuesta.
      clearTimeout(pending.timer);
      this.timers.delete(pending.timer);
      pending.timer = this.later(pending.finish, 400);
    }
  }

  submit(playerId, value) {
    const pending = this.pending;
    if (!pending || !pending.participants.includes(playerId) || pending.answers.has(playerId)) return;
    if (pending.validate && !pending.validate(value)) return;
    pending.answers.set(playerId, { value, at: Date.now() });
    this.lastActivity = Date.now();
    this.broadcast();
    this.checkComplete();
  }

  // Mensajes del jugador: elegir región, contestar opción o número.
  handle(playerId, msg) {
    const pending = this.pending;
    if (!pending) return;
    if (msg.t === 'cq_pick' && this.phase.endsWith('_pick')) {
      if (pending.options && pending.options.includes(msg.region)) this.submit(playerId, msg.region);
    } else if (msg.t === 'cq_choice' && this.phase === 'bat_question') {
      const option = Number(msg.option);
      if (Number.isInteger(option) && option >= 0 && option < this.view.question.options.length) {
        this.submit(playerId, option);
      }
    } else if (msg.t === 'cq_guess' && (this.phase === 'exp_question' || this.phase === 'bat_tiebreak')) {
      const value = Number(msg.value);
      if (Number.isFinite(value) && Math.abs(value) < 1e12) this.submit(playerId, value);
    }
  }

  // ---------- preguntas ----------
  async nextNumeric() {
    if (this.numericPool.length === 0) this.numericPool = await this.loadNumeric(20);
    if (this.numericPool.length === 0) throw new Error('No hay preguntas de aproximación');
    return this.numericPool.shift();
  }

  async nextChoice() {
    if (this.choicePool.length === 0) this.choicePool = await this.loadChoice(15);
    if (this.choicePool.length === 0) throw new Error('No hay preguntas');
    return this.choicePool.shift();
  }

  botGuess(q) {
    return (p) => {
      const isYear = /año/i.test(q.unit || '') && q.answer > 500 && q.answer < 2100;
      const spread = isYear ? 25 * (1.4 - p.skill) : Math.abs(q.answer) * 0.25 * (1.3 - p.skill);
      let value = q.answer + gaussian() * spread;
      value = Math.abs(q.answer) >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
      if (q.answer >= 0) value = Math.max(0, value);
      return { value, delayMs: 3_000 + Math.random() * 8_000 };
    };
  }

  // Pregunta de aproximación: devuelve los participantes ordenados del más cercano al más lejano.
  async numericRound(phase, participants, extraView = {}) {
    const q = await this.nextNumeric();
    if (this.destroyed) throw new Cancelled();
    this.view = { ...extraView, question: { kind: 'numeric', text: q.text, unit: q.unit, category: q.category } };
    this.phase = phase;
    this.result = null;
    const answers = await this.collect(participants, CQ.numericMs, { botAnswer: this.botGuess(q) });
    const guesses = participants.map((id) => {
      const a = answers.get(id);
      return { playerId: id, value: a ? a.value : null, diff: a ? Math.abs(a.value - q.answer) : null, at: a ? a.at : Infinity };
    });
    const tiebreak = new Map(participants.map((id) => [id, Math.random()]));
    guesses.sort((a, b) => {
      if (a.diff === null && b.diff === null) return tiebreak.get(a.playerId) - tiebreak.get(b.playerId);
      if (a.diff === null) return 1;
      if (b.diff === null) return -1;
      return a.diff - b.diff || a.at - b.at;
    });
    const ranking = guesses.map(({ playerId, value, diff }) => ({ playerId, value, diff }));
    return { q, ranking };
  }

  // ---------- partida ----------
  async run() {
    try {
      await this.intro();
      while (REGIONS.some((r) => this.owner[r] === null)) await this.expansionRound();
      for (this.round = 1; this.round <= CQ.battleRounds; this.round++) {
        const order = this.players.map((_, i) => this.players[(i + this.round - 1) % this.players.length]);
        for (const attacker of order) {
          if (this.active().length < 2) break;
          if (!attacker.eliminated) await this.battleTurn(attacker);
        }
        if (this.active().length < 2) break;
      }
      await this.finish();
    } catch (err) {
      if (err instanceof Cancelled || this.destroyed) return;
      console.error('[conquista] error en la partida', err);
      for (const p of this.players) if (!p.isBot) this.send(p.id, { t: 'error', message: 'La partida ha fallado, lo sentimos' });
      this.destroy();
    }
  }

  async intro() {
    const castles = shuffle(pickRandom(CASTLE_SETS));
    this.players.forEach((p, i) => {
      p.castle = castles[i];
      this.owner[castles[i]] = p.id;
      this.value[castles[i]] = CQ.castleValue;
    });
    this.event = 'Cada jugador empieza con un castillo. ¡A repartirse España!';
    this.setPhase('intro');
    await this.wait(CQ.introMs);
  }

  freeRegions() {
    return REGIONS.filter((r) => this.owner[r] === null);
  }

  // Regiones libres que puede elegir: si tiene alguna libre al lado, solo esas.
  pickableFor(id) {
    const free = this.freeRegions();
    const mine = new Set(this.regionsOf(id));
    const near = free.filter((r) => ADJ[r].some((n) => mine.has(n)));
    return near.length ? near : free;
  }

  async expansionRound() {
    const ids = this.players.map((p) => p.id);
    this.event = 'Reparto: el que más se acerque elige dos regiones; el segundo, una.';
    const { q, ranking } = await this.numericRound('exp_question', ids);
    this.setPhase('exp_result', {}, { result: { kind: 'numeric', answer: q.answer, unit: q.unit, text: q.text, ranking } });
    await this.wait(CQ.resultMs);

    const turns = [ranking[0].playerId, ranking[0].playerId, ranking[1].playerId];
    for (const id of turns) {
      if (this.freeRegions().length === 0) break;
      await this.pickRegion('exp_pick', id, this.pickableFor(id), (region) => {
        this.owner[region] = id;
        this.value[region] = CQ.regionValue;
        this.event = `${this.player(id).name} ocupa ${NAMES[region]}`;
      });
    }
  }

  // Un jugador elige una región de la lista (si no elige a tiempo, se elige al azar).
  async pickRegion(phase, playerId, options, apply, extraView = {}) {
    this.phase = phase;
    this.result = null;
    this.view = { ...extraView, picker: playerId, options };
    const pending = this.collect([playerId], CQ.pickMs, {
      botAnswer: () => ({ value: this.botTarget(playerId, options), delayMs: 1_200 + Math.random() * 1_500 }),
    });
    this.pending.options = options;
    const answers = await pending;
    const a = answers.get(playerId);
    const region = a && options.includes(a.value) ? a.value : pickRandom(options);
    apply(region);
    this.broadcast();
    return region;
  }

  botTarget(playerId, options) {
    const plain = options.filter((r) => !this.players.some((p) => p.castle === r && this.owner[r] === p.id));
    return pickRandom(plain.length && Math.random() < 0.75 ? plain : options);
  }

  async battleTurn(attacker) {
    const enemy = (r) => this.owner[r] && this.owner[r] !== attacker.id;
    const mine = new Set(this.regionsOf(attacker.id));
    let targets = REGIONS.filter((r) => enemy(r) && ADJ[r].some((n) => mine.has(n)));
    if (targets.length === 0) targets = REGIONS.filter(enemy);
    if (targets.length === 0) return;

    this.event = `Ronda ${this.round} de ${CQ.battleRounds}: ataca ${attacker.name}`;
    const target = await this.pickRegion('bat_pick', attacker.id, targets, () => {}, { attackerId: attacker.id });
    const defender = this.player(this.owner[target]);
    const attack = { attackerId: attacker.id, defenderId: defender.id, region: target };
    const isCastle = defender.castle === target;
    this.event = isCastle
      ? `¡${attacker.name} ataca el castillo de ${defender.name}!`
      : `${attacker.name} ataca ${NAMES[target]} (de ${defender.name})`;

    // Pregunta con opciones para atacante y defensor.
    const q = await this.nextChoice();
    if (this.destroyed) throw new Cancelled();
    this.phase = 'bat_question';
    this.result = null;
    this.view = { attack, question: { kind: 'choice', text: q.text, options: q.options, category: q.category } };
    const answers = await this.collect([attacker.id, defender.id], CQ.choiceMs, {
      botAnswer: (p) => {
        const right = Math.random() < p.skill;
        const wrong = q.options.map((_, i) => i).filter((i) => i !== q.correctIndex);
        return { value: right ? q.correctIndex : pickRandom(wrong), delayMs: 2_000 + Math.random() * 7_000 };
      },
    });
    const aRight = answers.get(attacker.id)?.value === q.correctIndex;
    const dRight = answers.get(defender.id)?.value === q.correctIndex;
    let outcome = aRight && !dRight ? 'attacker' : !aRight && dRight ? 'defender' : aRight && dRight ? 'tiebreak' : 'none';
    this.setPhase('bat_result', { attack }, {
      result: {
        kind: 'choice',
        text: q.text,
        options: q.options,
        correctIndex: q.correctIndex,
        explanation: q.explanation || null,
        questionId: q.id,
        answers: { [attacker.id]: answers.get(attacker.id)?.value ?? null, [defender.id]: answers.get(defender.id)?.value ?? null },
        outcome,
      },
    });
    await this.wait(CQ.resultMs);

    if (outcome === 'tiebreak') {
      this.event = '¡Empate! Desempate con una pregunta de aproximación.';
      const { q: tq, ranking } = await this.numericRound('bat_tiebreak', [attacker.id, defender.id], { attack });
      outcome = ranking[0].playerId === attacker.id ? 'attacker' : 'defender';
      this.setPhase('bat_tie_result', { attack }, {
        result: { kind: 'numeric', answer: tq.answer, unit: tq.unit, text: tq.text, ranking, outcome },
      });
      await this.wait(CQ.resultMs);
    }

    if (outcome === 'attacker') this.conquer(attacker, defender, target, isCastle);
    else if (outcome === 'defender') {
      defender.bonus += CQ.defenseBonus;
      this.event = `🛡️ ${defender.name} defiende ${NAMES[target]} (+${CQ.defenseBonus})`;
    } else {
      this.event = `Nadie acierta: ${NAMES[target]} sigue siendo de ${defender.name}`;
    }
    this.setPhase('bat_outcome', { attack: { ...attack, outcome } });
    await this.wait(Math.round(CQ.resultMs * 0.6));
  }

  conquer(attacker, defender, region, isCastle) {
    if (!isCastle) {
      this.owner[region] = attacker.id;
      this.value[region] += CQ.conquestBonus;
      this.event = `⚔️ ${attacker.name} conquista ${NAMES[region]}`;
      return;
    }
    defender.towers -= 1;
    if (defender.towers > 0) {
      this.event = `💥 ${attacker.name} derriba una torre del castillo de ${defender.name} (quedan ${defender.towers})`;
      return;
    }
    // Castillo tomado: el atacante se queda con todo el territorio del defensor.
    for (const r of this.regionsOf(defender.id)) this.owner[r] = attacker.id;
    defender.eliminated = true;
    this.event = `🏰 ¡${attacker.name} toma el castillo de ${defender.name} y se queda con todo su territorio!`;
  }

  ranking() {
    const rows = this.players
      .map((p) => ({
        playerId: p.id,
        name: p.name,
        isBot: p.isBot,
        color: p.color,
        left: p.left,
        eliminated: p.eliminated,
        score: this.score(p),
        regions: this.regionsOf(p.id).length,
        correctCount: 0,
        ratingBefore: null,
        ratingAfter: null,
      }))
      .sort((a, b) => b.score - a.score || b.regions - a.regions);
    let position = 0;
    return rows.map((r, i) => {
      if (i === 0 || rows[i - 1].score !== r.score || rows[i - 1].regions !== r.regions) position = i + 1;
      return { ...r, position };
    });
  }

  async finish() {
    this.pending = null;
    let ranking = this.ranking();
    try {
      ranking = (await this.onFinished(this, ranking)) || ranking;
    } catch (err) {
      console.error('[conquista] no se pudo guardar la partida', err);
    }
    if (this.destroyed) return;
    this.status = 'finished';
    this.event = 'Fin de la partida';
    this.setPhase('end', {}, { result: { kind: 'end', ranking } });
  }

  // ---------- conexión ----------
  setConnected(id, connected) {
    const p = this.player(id);
    if (!p || p.isBot) return;
    p.connected = connected;
    if (connected) p.left = false;
    this.lastActivity = Date.now();
    if (!connected) {
      if (!this.players.some((x) => !x.isBot && x.connected)) return this.destroy();
      this.checkComplete();
    }
    this.broadcast();
  }

  removePlayer(id) {
    const p = this.player(id);
    if (!p || p.isBot) return;
    p.left = true;
    p.connected = false;
    if (this.status === 'finished' || !this.players.some((x) => !x.isBot && x.connected)) return this.destroy();
    this.checkComplete();
    this.broadcast();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.pending = null;
    this.onEmpty(this);
  }
}

module.exports = { ConquistaGame, COLORS };
