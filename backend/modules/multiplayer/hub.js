const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { config } = require('./config');
const { Room, GameError } = require('./room');
const { createBot } = require('./bot');
const { normalizeCategory } = require('../questions/validate');
const players = require('../players/service');
const persist = require('./persist');
const { ConquistaGame } = require('../conquista/game');
const { CQ } = require('../conquista/config');
const cqPersist = require('../conquista/persist');
const shop = require('../shop/service');
const countries = require('../countries/service');
const chat = require('../chat/service');

function shuffleList(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_CONNECTIONS_PER_IP = 10;
const HELLO_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 30_000;

// Servidor de partidas en red sobre WebSocket (ruta /ws).
// Todo el estado vive en memoria: funciona con una sola instancia del servidor.
function attachMultiplayer(server, deps = {}) {
  const findPlayer = deps.findPlayer || players.findByToken;
  const loadQuestions = deps.loadQuestions || persist.loadQuestions;
  const saveMatch = deps.saveMatch || persist.saveMatch;
  const loadNumeric = deps.loadNumeric || cqPersist.loadNumeric;
  const loadChoice = deps.loadChoice || cqPersist.loadChoice;
  const saveConquista = deps.saveConquista || cqPersist.saveConquista;
  const useItem = deps.useItem || shop.useItem;
  const loadOwned = deps.loadOwned || countries.ownedBy;
  const allyQuestion = deps.allyQuestion || countries.allyQuestion;
  const postMatchChat = deps.postMatchChat || chat.postMatch;

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  const clients = new Map(); // playerId → conexión
  const membership = new Map(); // playerId → código de sala
  const rooms = new Map(); // código → Room
  const queue = new Map(); // playerId → { since, botTimer }
  const cqQueue = new Map(); // playerId → desde cuándo espera una partida de Conquista
  let cqTimer = null;
  const ipCounts = new Map();

  // ---------- envío ----------
  function send(playerId, msg) {
    const conn = clients.get(playerId);
    if (conn && conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(msg));
  }

  function sendTo(conn, msg) {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(msg));
  }

  // ---------- salas ----------
  function newCode(prefix = '') {
    for (;;) {
      let code = prefix;
      for (let i = 0; i < 5; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
      if (!rooms.has(code)) return code;
    }
  }

  function onEmpty(r) {
    rooms.delete(r.code);
    for (const [pid, code] of membership) if (code === r.code) membership.delete(pid);
  }

  function createRoom(options) {
    if (rooms.size >= config.maxRooms) throw new GameError('El servidor está lleno, inténtalo en un rato');
    const room = new Room({
      ...options,
      send,
      loadQuestions,
      onFinished: saveMatch,
      onEmpty,
    });
    rooms.set(room.code, room);
    return room;
  }

  function currentRoom(playerId) {
    const code = membership.get(playerId);
    return code ? rooms.get(code) : null;
  }

  function leaveEverything(playerId) {
    leaveQueue(playerId);
    const room = currentRoom(playerId);
    membership.delete(playerId);
    if (room) room.removePlayer(playerId);
  }

  // Antes de entrar en otra partida: salir de la anterior si ya terminó.
  function ensureFree(playerId) {
    const room = currentRoom(playerId);
    if (room && room.status !== 'finished' && room.status !== 'lobby') {
      throw new GameError('Ya estás jugando una partida');
    }
    leaveEverything(playerId);
  }

  // ---------- duelos ----------
  // ---------- Conquista (3 jugadores) ----------
  function cqQueueStatus() {
    const startsInMs = cqTimer ? Math.max(0, cqTimer.at - Date.now()) : null;
    for (const id of cqQueue.keys()) send(id, { t: 'cq_queued', waiting: cqQueue.size, needed: CQ.players, startsInMs });
  }

  async function startConquista() {
    clearTimeout(cqTimer?.handle);
    cqTimer = null;
    const ids = [...cqQueue.keys()].filter((id) => clients.has(id)).slice(0, CQ.players);
    for (const id of ids) cqQueue.delete(id);
    if (ids.length === 0) return;
    if (rooms.size >= config.maxRooms) {
      for (const id of ids) send(id, { t: 'error', message: 'El servidor está lleno, inténtalo en un rato' });
      return;
    }
    // Países de cada jugador (para usarlos como aliados al atacar).
    let owned = {};
    try {
      owned = await loadOwned(ids);
    } catch (err) {
      console.error('[conquista] países', err.context || '', err.cause || err);
    }
    const participants = ids.filter((id) => clients.has(id)).map((id) => ({ ...clients.get(id).player, countries: owned[id] || [] }));
    if (participants.length === 0) return;
    const taken = participants.map((p) => p.name);
    while (participants.length < CQ.players) {
      const bot = createBot(taken);
      taken.push(bot.name);
      participants.push(bot);
    }
    const game = new ConquistaGame({
      code: newCode('C'),
      players: shuffleList(participants),
      send,
      loadNumeric,
      loadChoice,
      allyQuestion,
      onFinished: saveConquista,
      onEmpty,
    });
    rooms.set(game.code, game);
    for (const id of ids) membership.set(id, game.code);
    game.run();
    // Si quedaron jugadores esperando, empieza otra cuenta atrás para ellos.
    if (cqQueue.size > 0) armCqTimer();
  }

  function armCqTimer() {
    if (cqTimer) return;
    const at = Date.now() + CQ.botWaitMs;
    cqTimer = { at, handle: setTimeout(() => startConquista().catch((e) => console.error('[conquista] inicio', e)), CQ.botWaitMs) };
  }

  function joinCqQueue(conn) {
    const me = conn.player;
    ensureFree(me.id);
    cqQueue.set(me.id, Date.now());
    if (cqQueue.size >= CQ.players) return startConquista().catch((e) => console.error('[conquista] inicio', e));
    armCqTimer();
    cqQueueStatus();
  }

  function leaveQueue(playerId) {
    if (cqQueue.delete(playerId)) {
      if (cqQueue.size === 0) {
        clearTimeout(cqTimer?.handle);
        cqTimer = null;
      }
      cqQueueStatus();
    }
    const entry = queue.get(playerId);
    if (!entry) return;
    clearTimeout(entry.botTimer);
    queue.delete(playerId);
  }

  async function startDuel(participants) {
    const room = createRoom({ code: newCode('D'), mode: 'duel', questionCount: config.duelQuestions });
    for (const p of participants) {
      room.addPlayer(p);
      if (!p.isBot) membership.set(p.id, room.code);
    }
    try {
      await room.start();
    } catch (err) {
      const message = err instanceof GameError ? err.message : 'No se pudo empezar el duelo';
      if (!(err instanceof GameError)) console.error('[multiplayer] startDuel', err);
      for (const p of participants) if (!p.isBot) send(p.id, { t: 'error', message });
      room.destroy();
    }
  }

  function joinQueue(conn) {
    const me = conn.player;
    ensureFree(me.id);
    const rival = [...queue.keys()].find((id) => id !== me.id && clients.has(id));
    if (rival) {
      leaveQueue(rival);
      const rivalPlayer = clients.get(rival).player;
      startDuel([rivalPlayer, me]);
      return;
    }
    const botTimer = setTimeout(() => {
      if (!queue.has(me.id)) return;
      queue.delete(me.id);
      startDuel([me, createBot()]);
    }, config.botWaitMs);
    queue.set(me.id, { since: Date.now(), botTimer });
    sendTo(conn, { t: 'queued', botWaitMs: config.botWaitMs });
  }

  // ---------- mensajes ----------
  const handlers = {
    ping(conn) {
      sendTo(conn, { t: 'pong' });
    },
    queue(conn) {
      joinQueue(conn);
    },
    cancel_queue(conn) {
      leaveQueue(conn.player.id);
      sendTo(conn, { t: 'queue_cancelled' });
    },
    create_room(conn, msg) {
      const me = conn.player;
      ensureFree(me.id);
      const questionCount = config.roomQuestionOptions.includes(Number(msg.questionCount))
        ? Number(msg.questionCount)
        : config.roomDefaultQuestions;
      const room = createRoom({
        code: newCode(),
        mode: 'room',
        category: msg.category ? normalizeCategory(msg.category) : null,
        questionCount,
      });
      room.addPlayer(me);
      membership.set(me.id, room.code);
    },
    join_room(conn, msg) {
      const me = conn.player;
      const code = String(msg.code || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room || room.mode !== 'room') throw new GameError('No existe ninguna sala con ese código');
      if (membership.get(me.id) === code) {
        room.addPlayer(me);
        room.syncPlayer(me.id);
        return;
      }
      ensureFree(me.id);
      room.addPlayer(me);
      membership.set(me.id, code);
    },
    settings(conn, msg) {
      const room = requireRoom(conn);
      room.updateSettings(conn.player.id, {
        category: msg.category === undefined ? undefined : msg.category ? normalizeCategory(msg.category) : null,
        questionCount: msg.questionCount,
      });
    },
    add_bot(conn) {
      requireRoom(conn).addBot(conn.player.id);
    },
    remove_bot(conn, msg) {
      requireRoom(conn).removeBot(conn.player.id, String(msg.playerId || ''));
    },
    async start(conn) {
      await requireRoom(conn).start(conn.player.id);
    },
    cq_queue(conn) {
      joinCqQueue(conn);
    },
    cq_cancel(conn) {
      leaveQueue(conn.player.id);
      sendTo(conn, { t: 'queue_cancelled' });
    },
    cq_pick(conn, msg) {
      const room = currentRoom(conn.player.id);
      if (room && room.mode === 'conquista') room.handle(conn.player.id, msg);
    },
    cq_choice(conn, msg) {
      handlers.cq_pick(conn, msg);
    },
    cq_guess(conn, msg) {
      handlers.cq_pick(conn, msg);
    },
    cq_ally(conn, msg) {
      handlers.cq_pick(conn, msg);
    },
    answer(conn, msg) {
      const room = currentRoom(conn.player.id);
      if (room && room.mode !== 'conquista') room.answer(conn.player.id, Number(msg.index), Number(msg.option));
    },
    async helper(conn, msg) {
      const room = currentRoom(conn.player.id);
      if (!room || room.status === 'finished') throw new GameError('No estás en ninguna partida');
      const kind = String(msg.kind || '');
      const offer = room.helperOffer(conn.player.id, kind);
      let left;
      try {
        left = await useItem(conn.player.id, kind);
      } catch (err) {
        offer.cancel();
        throw err;
      }
      if (left === null) {
        offer.cancel();
        throw new GameError('No te quedan comodines de ese tipo. ¡Consíguelos en la tienda!');
      }
      sendTo(conn, { t: 'helper', kind, left, ...offer.payload });
    },
    rematch(conn) {
      requireRoom(conn).rematch(conn.player.id);
    },
    // Chat de la partida: se guarda (para poder reportarlo) y se reparte a los jugadores de la sala,
    // salvo a quien haya bloqueado al autor.
    async chat(conn, msg) {
      const room = currentRoom(conn.player.id);
      if (!room) throw new GameError('No estás en ninguna partida');
      let message;
      try {
        message = await postMatchChat(conn.player.id, room.code, msg.text);
      } catch (err) {
        if (err.status) throw new GameError(err.message);
        throw err;
      }
      for (const id of humanIds(room)) {
        if (id === conn.player.id || !chat.hides(id, conn.player.id)) send(id, { t: 'chat', message });
      }
    },
    leave(conn) {
      leaveEverything(conn.player.id);
      sendTo(conn, { t: 'left' });
    },
  };

  function humanIds(room) {
    const list = room.players instanceof Map ? [...room.players.values()] : room.players;
    return list.filter((p) => !p.isBot && !p.left).map((p) => p.id);
  }

  function requireRoom(conn) {
    const room = currentRoom(conn.player.id);
    if (!room || room.mode === 'conquista') throw new GameError('No estás en ninguna sala');
    return room;
  }

  async function hello(conn, msg) {
    let player = null;
    try {
      player = await findPlayer(msg.token);
    } catch (err) {
      console.error('[multiplayer] hello', err);
      sendTo(conn, { t: 'error', code: 'server', message: 'Error del servidor, inténtalo de nuevo' });
      return conn.ws.close(1011);
    }
    if (!player || !player.hasAccount) {
      sendTo(conn, { t: 'error', code: 'auth', message: 'Entra con tu cuenta de Google para jugar' });
      return conn.ws.close(4001, 'auth');
    }
    clearTimeout(conn.helloTimer);

    const old = clients.get(player.id);
    if (old && old !== conn) {
      old.replaced = true;
      sendTo(old, { t: 'error', code: 'replaced', message: 'Has abierto el juego en otra pestaña' });
      old.ws.close(4002, 'replaced');
    }
    conn.player = player;
    clients.set(player.id, conn);
    // Carga sus bloqueos para filtrar el chat de partida.
    chat.blockedBy(player.id).catch((err) => console.error('[multiplayer] bloqueos', err.message));

    let room = currentRoom(player.id);
    // Una partida ya terminada no se retoma: al volver, empieza de cero.
    if (room && room.status === 'finished') {
      leaveEverything(player.id);
      room = null;
    }
    sendTo(conn, { t: 'welcome', player, roomCode: room ? room.code : null });
    if (room) {
      room.setConnected(player.id, true);
      room.syncPlayer(player.id);
    }
  }

  async function onMessage(conn, raw) {
    // Límite simple: 10 mensajes por segundo con ráfagas de hasta 20.
    const now = Date.now();
    conn.tokens = Math.min(20, conn.tokens + ((now - conn.lastRefill) / 1000) * 10);
    conn.lastRefill = now;
    if (conn.tokens < 1) return;
    conn.tokens -= 1;

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'hello') return hello(conn, msg);
    if (!conn.player) return sendTo(conn, { t: 'error', code: 'auth', message: 'Falta identificarse' });
    const handler = Object.prototype.hasOwnProperty.call(handlers, msg.t) ? handlers[msg.t] : null;
    if (!handler) return;
    try {
      await handler(conn, msg);
    } catch (err) {
      if (err instanceof GameError) {
        sendTo(conn, { t: 'error', message: err.message });
      } else {
        console.error(`[multiplayer] ${msg.t}`, err);
        sendTo(conn, { t: 'error', message: 'Error del servidor' });
      }
    }
  }

  function onClose(conn) {
    ipCounts.set(conn.ip, (ipCounts.get(conn.ip) || 1) - 1);
    if (ipCounts.get(conn.ip) <= 0) ipCounts.delete(conn.ip);
    clearTimeout(conn.helloTimer);
    if (!conn.player || conn.replaced || clients.get(conn.player.id) !== conn) return;
    clients.delete(conn.player.id);
    leaveQueue(conn.player.id);
    const room = currentRoom(conn.player.id);
    if (room) room.setConnected(conn.player.id, false);
  }

  wss.on('connection', (ws, req) => {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
    if ((ipCounts.get(ip) || 0) >= MAX_CONNECTIONS_PER_IP) {
      ws.close(4029, 'too many connections');
      return;
    }
    ipCounts.set(ip, (ipCounts.get(ip) || 0) + 1);

    const conn = { ws, ip, player: null, tokens: 20, lastRefill: Date.now(), alive: true };
    conn.helloTimer = setTimeout(() => ws.close(4001, 'hello timeout'), HELLO_TIMEOUT_MS);
    ws.on('pong', () => (conn.alive = true));
    ws.on('message', (data) => onMessage(conn, data.toString()));
    ws.on('close', () => onClose(conn));
    ws.on('error', () => {});
    ws.conn = conn;
  });

  // Conexiones muertas (móvil sin cobertura, pestaña cerrada de golpe...).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.conn.alive) {
        ws.terminate();
        continue;
      }
      ws.conn.alive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);

  // Limpieza de salas abandonadas.
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      const idle = now - room.lastActivity;
      if ((room.status === 'finished' && idle > config.finishedRoomTtlMs) || idle > 60 * 60_000) room.destroy();
    }
  }, 60_000);
  heartbeat.unref();
  cleanup.unref();

  return {
    wss,
    stats: () => ({ connections: wss.clients.size, players: clients.size, rooms: rooms.size, queue: queue.size, cqQueue: cqQueue.size }),
    close() {
      clearInterval(heartbeat);
      clearInterval(cleanup);
      for (const entry of queue.values()) clearTimeout(entry.botTimer);
      clearTimeout(cqTimer?.handle);
      for (const room of [...rooms.values()]) room.destroy();
      for (const ws of wss.clients) ws.close(1001, 'server shutting down');
      wss.close();
    },
  };
}

module.exports = { attachMultiplayer };
