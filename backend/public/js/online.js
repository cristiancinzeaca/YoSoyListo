(function () {
  const $ = (id) => document.getElementById(id);
  const MODE = location.pathname.startsWith('/duelo') ? 'duel' : 'room';
  const params = new URLSearchParams(location.search);
  const SCREENS = ['s-connecting', 's-queue', 's-lobby', 's-countdown', 's-game', 's-end', 's-fatal'];

  const state = {
    me: null,
    room: null,
    phase: 'connecting', // connecting | queue | lobby | countdown | question | reveal | end | fatal
    question: null,
    deadline: 0,
    duration: 1,
    myAnswer: null,
    introDone: false,
    queueSince: 0,
    lastQuestionId: null,
  };

  // ---------- utilidades de pantalla ----------
  function show(id) {
    for (const s of SCREENS) $(s).hidden = s !== id;
    if (state.shown !== id) FX.screen($(id));
    state.shown = id;
  }

  let bannerTimer;
  function banner(text, { warn = false, sticky = false } = {}) {
    const el = $('banner');
    clearTimeout(bannerTimer);
    if (!text) {
      el.hidden = true;
      return;
    }
    el.textContent = text;
    el.className = warn ? 'banner warn' : 'banner';
    el.hidden = false;
    if (!sticky) bannerTimer = setTimeout(() => (el.hidden = true), 3500);
  }

  function fatal(title, text) {
    state.phase = 'fatal';
    $('fatal-title').textContent = title;
    $('fatal-text').textContent = text;
    show('s-fatal');
    socket.stop();
  }

  // ---------- conexión con reconexión automática ----------
  const socket = {
    ws: null,
    attempts: 0,
    stopped: false,
    connect() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      ws.onopen = () => {
        this.attempts = 0;
        ws.send(JSON.stringify({ t: 'hello', token: Player.token }));
      };
      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        onMessage(msg);
      };
      ws.onclose = (event) => {
        if (this.stopped || ws !== this.ws) return;
        if (event.code === 4001) return reauth();
        if (event.code === 4002) return;
        this.attempts += 1;
        const delay = Math.min(8000, 500 * 2 ** this.attempts);
        if (state.phase !== 'end') banner('Conexión perdida. Reconectando…', { warn: true, sticky: true });
        setTimeout(() => this.connect(), delay);
      };
    },
    send(msg) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    },
    stop() {
      this.stopped = true;
      if (this.ws) this.ws.close();
    },
  };

  async function reauth() {
    Player.forget();
    await Player.ensure('Tu sesión ha caducado. Vuelve a entrar con Google.');
  }

  // Comodín 50/50 (en duelos y salas solo existe este).
  let helperWait = null;
  const helperBar = HelperBar.create(['fifty'], (kind) => {
    if (state.phase !== 'question' || state.myAnswer !== null) return false;
    return new Promise((resolve, reject) => {
      helperWait = { resolve, reject, index: state.question.index };
      socket.send({ t: 'helper', kind });
      setTimeout(() => {
        if (helperWait && helperWait.resolve === resolve) {
          helperWait = null;
          reject(new Error('Sin respuesta del servidor'));
        }
      }, 5000);
    });
  });

  function onHelper(msg) {
    Wallet.setCount(msg.kind, msg.left);
    if (helperWait) {
      helperWait.resolve(true);
      helperWait = null;
    }
    if (msg.kind === 'fifty' && state.question && msg.index === state.question.index && state.phase === 'question') {
      HelperBar.applyFifty([...$('g-options').children], msg.remove);
    }
    helperBar.refresh();
  }

  // ---------- mensajes del servidor ----------
  function onMessage(msg) {
    switch (msg.t) {
      case 'welcome':
        return onWelcome(msg);
      case 'queued':
        state.phase = 'queue';
        state.queueSince = Date.now();
        show('s-queue');
        return;
      case 'room':
        return onRoom(msg.room);
      case 'countdown':
        return onCountdown(msg.ms);
      case 'question':
        return onQuestion(msg);
      case 'answered':
        return markAnswered(msg.playerId);
      case 'reveal':
        return onReveal(msg);
      case 'end':
        return onEnd(msg);
      case 'left':
        location.href = '/';
        return;
      case 'helper':
        return onHelper(msg);
      case 'chat':
        return window.Chat && Chat.match.receive(msg.message);
      case 'error':
        if (helperWait) {
          helperWait.reject(new Error(msg.message));
          helperWait = null;
          return;
        }
        return onError(msg);
      default:
    }
  }

  function onWelcome(msg) {
    banner('');
    state.me = msg.player;
    Player.save(msg.player);
    Wallet.load().then(() => helperBar.refresh());
    if (msg.roomCode) return; // el servidor nos manda el estado de la partida
    if (state.introDone && state.phase !== 'queue' && state.phase !== 'connecting') {
      if (state.phase !== 'end') fatal('La partida se ha cortado', 'El servidor se ha reiniciado y la partida se ha perdido. ¡Lo sentimos!');
      return;
    }
    state.introDone = true;
    if (MODE === 'duel') {
      socket.send({ t: 'queue' });
    } else if (params.get('c')) {
      socket.send({ t: 'join_room', code: params.get('c') });
    } else {
      socket.send({
        t: 'create_room',
        questionCount: Number(params.get('n')) || undefined,
        category: params.get('cat') || undefined,
      });
    }
  }

  function onError(msg) {
    if (msg.code === 'replaced') {
      return fatal('Partida abierta en otra pestaña', 'Has abierto el juego en otra pestaña o dispositivo. Sigue jugando allí.');
    }
    if (msg.code === 'auth') return;
    if (/No existe ninguna sala/.test(msg.message) || /llena|ya ha empezado/.test(msg.message)) {
      if (state.phase === 'connecting') return fatal('No puedes entrar', msg.message);
    }
    banner(msg.message, { warn: true });
  }

  // ---------- sala ----------
  function isHost() {
    return state.room && state.me && state.room.hostId === state.me.id;
  }

  function onRoom(room) {
    if (window.Chat) Chat.match.start((m) => socket.send(m));
    state.room = room;
    if (room.mode === 'room' && params.get('c') !== room.code) {
      params.set('c', room.code);
      params.delete('crear');
      params.delete('n');
      params.delete('cat');
      history.replaceState(null, '', `/sala?${params}`);
    }
    if (room.status === 'lobby') {
      if (state.phase === 'lobby' && room.players.length > (state.lobbySize || 0)) FX.play('turn');
      state.lobbySize = room.players.length;
      state.phase = 'lobby';
      renderLobby();
      show('s-lobby');
    } else if (room.status === 'starting' && state.phase === 'lobby') {
      $('start-btn').disabled = true;
    }
    if (state.phase === 'question' || state.phase === 'reveal') renderStrip();
  }

  function renderLobby() {
    const room = state.room;
    $('lobby-code').textContent = room.code;
    $('lobby-count').textContent = `(${room.players.length}/${room.maxPlayers})`;
    const list = $('lobby-players');
    list.replaceChildren();
    for (const p of room.players) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'grow';
      name.textContent = p.name + (state.me && p.id === state.me.id ? ' (tú)' : '');
      li.append(FX.avatar(p.name, p.avatar), name);
      if (p.id === room.hostId) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = '👑 anfitrión';
        li.appendChild(tag);
      }
      if (!p.connected) {
        const tag = document.createElement('span');
        tag.className = 'tag off';
        tag.textContent = 'sin conexión';
        li.appendChild(tag);
      }
      if (p.isBot && isHost()) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '✕';
        remove.title = 'Quitar bot';
        remove.addEventListener('click', () => socket.send({ t: 'remove_bot', playerId: p.id }));
        li.appendChild(remove);
      }
      list.appendChild(li);
    }

    const host = isHost();
    $('host-controls').hidden = !host;
    $('guest-note').hidden = host;
    $('start-btn').disabled = room.players.length < 2;
    $('start-btn').textContent = room.players.length < 2 ? 'Esperando jugadores…' : 'Empezar partida';
    $('add-bot').disabled = room.players.length >= room.maxPlayers;
    $('lobby-category').value = room.category || '';
    for (const b of $('lobby-count-seg').children) b.classList.toggle('active', Number(b.dataset.n) === room.questionCount);
    $('lobby-settings').textContent = `${room.questionCount} preguntas · ${categoryLabel(room.category)}`;
  }

  async function loadCategories() {
    try {
      const { categories } = await api.get('/api/questions/categories');
      for (const c of categories) {
        const opt = document.createElement('option');
        opt.value = c.category;
        opt.textContent = categoryLabel(c.category);
        $('lobby-category').appendChild(opt);
      }
      if (state.room) $('lobby-category').value = state.room.category || '';
    } catch {
      // se puede jugar con "Todas"
    }
  }

  $('lobby-category').addEventListener('change', (e) => socket.send({ t: 'settings', category: e.target.value }));
  $('lobby-count-seg').addEventListener('click', (e) => {
    const n = e.target.dataset && e.target.dataset.n;
    if (n) socket.send({ t: 'settings', questionCount: Number(n) });
  });
  $('add-bot').addEventListener('click', () => socket.send({ t: 'add_bot' }));
  $('start-btn').addEventListener('click', () => {
    $('start-btn').disabled = true;
    socket.send({ t: 'start' });
  });
  $('leave-btn').addEventListener('click', () => socket.send({ t: 'leave' }));
  $('queue-cancel').addEventListener('click', () => socket.send({ t: 'cancel_queue' }));

  $('share-btn').addEventListener('click', async () => {
    const url = `${location.origin}/sala?c=${state.room.code}`;
    const text = `¡Juega conmigo a Yo Soy Listo! Código de sala: ${state.room.code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Yo Soy Listo', text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      $('share-note').textContent = '¡Enlace copiado! Pégalo en WhatsApp o donde quieras.';
    } catch {
      $('share-note').textContent = `Comparte este enlace: ${url}`;
    }
    $('share-note').hidden = false;
  });

  // ---------- partida ----------
  function onCountdown(ms) {
    state.phase = 'countdown';
    show('s-countdown');
    const end = Date.now() + ms;
    const step = () => {
      if (state.phase !== 'countdown') return;
      const left = Math.ceil((end - Date.now()) / 1000);
      const span = document.createElement('span');
      span.textContent = left > 0 ? left : '¡Ya!';
      $('s-countdown').replaceChildren(span);
      FX.play(left > 0 ? 'tick' : 'go');
      if (left > 0) setTimeout(step, ((end - Date.now()) % 1000) || 1000);
    };
    step();
  }

  function myScore() {
    const me = state.room && state.room.players.find((p) => p.id === state.me.id);
    return me ? me.score : 0;
  }

  function onQuestion(msg) {
    state.phase = 'question';
    state.question = msg;
    state.myAnswer = msg.myAnswer;
    state.duration = msg.durationMs;
    state.deadline = performance.now() + msg.timeLeftMs;
    show('s-game');

    $('g-progress').textContent = `Pregunta ${msg.index + 1} de ${msg.total}`;
    $('g-score').textContent = myScore();
    $('g-cat').textContent = categoryLabel(msg.question.category);
    $('g-text').textContent = msg.question.text;
    FX.enter($('g-card'));
    $('g-note').hidden = true;
    $('g-report').hidden = true;
    const options = $('g-options');
    options.replaceChildren();
    msg.question.options.forEach((text, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'option';
      b.textContent = text;
      if (state.myAnswer !== null) {
        b.disabled = true;
        if (i === state.myAnswer) b.classList.add('mine');
      }
      b.addEventListener('click', () => answer(i));
      options.appendChild(b);
    });
    if (!helperBar.el.isConnected) options.after(helperBar.el);
    helperBar.reset();
    if (state.myAnswer !== null) helperBar.lock('fifty');
    renderStrip();
    requestAnimationFrame(tick);
  }

  function answer(i) {
    if (state.phase !== 'question' || state.myAnswer !== null) return;
    state.myAnswer = i;
    const buttons = [...$('g-options').children];
    buttons.forEach((b) => (b.disabled = true));
    buttons[i].classList.add('mine');
    helperBar.lock('fifty');
    socket.send({ t: 'answer', index: state.question.index, option: i });
    markAnswered(state.me.id);
  }

  function tick() {
    if (state.phase !== 'question') return;
    const left = Math.max(0, state.deadline - performance.now());
    $('g-timer').style.transform = `scaleX(${left / state.duration})`;
    $('g-timer').classList.toggle('low', left < 4000);
    const secs = Math.ceil(left / 1000);
    if (secs <= 3 && secs > 0 && state.myAnswer === null && secs !== state.lastTick) {
      state.lastTick = secs;
      FX.play('tick');
    }
    if (left > 0) requestAnimationFrame(tick);
  }

  function renderStrip() {
    if (!state.room) return;
    const strip = $('g-strip');
    strip.replaceChildren();
    const sorted = [...state.room.players].sort((a, b) => b.score - a.score);
    for (const p of sorted) {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.dataset.id = p.id;
      if (p.id === state.me.id) chip.classList.add('me');
      if (p.answered) chip.classList.add('done');
      if (!p.connected) chip.classList.add('off');
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = p.name;
      const s = document.createElement('span');
      s.className = 's';
      s.textContent = p.score;
      chip.append(FX.avatar(p.name, p.avatar), n, s);
      strip.appendChild(chip);
    }
  }

  function markAnswered(playerId) {
    const chip = $('g-strip').querySelector(`[data-id="${CSS.escape(playerId)}"]`);
    if (chip) chip.classList.add('done');
  }

  function onReveal(msg) {
    state.phase = 'reveal';
    if (!state.question || state.question.index !== msg.index) return;
    const buttons = [...$('g-options').children];
    buttons.forEach((b) => {
      b.disabled = true;
      b.classList.remove('mine');
    });
    buttons[msg.correctIndex].classList.add('correct');
    const mine = msg.results.find((r) => r.playerId === state.me.id);
    if (mine && mine.option !== null && !mine.correct) buttons[mine.option].classList.add('wrong');

    if (mine && mine.correct) {
      FX.play('correct');
      FX.vibrate(25);
      FX.burst(buttons[msg.correctIndex], { amount: mine.points >= 900 ? 34 : 22 });
      FX.float(`+${mine.points}`, buttons[msg.correctIndex], mine.points >= 900 ? 'big' : '');
      FX.bump($('g-score'));
      FX.mascot('gana');
    } else if (mine) {
      FX.mascot('falla');
      FX.play('wrong');
      FX.vibrate([60, 40, 60]);
      FX.shake($('g-card'));
      FX.float(mine.option === null ? '⏱' : '✗', mine.option === null ? $('g-card') : buttons[mine.option], 'bad');
    }

    if (mine) $('g-score').textContent = mine.score;
    const correctCount = msg.results.filter((r) => r.correct).length;
    $('g-note').textContent =
      (msg.explanation ? `${msg.explanation} · ` : '') + `Acertaron ${correctCount} de ${msg.results.length}`;
    $('g-note').hidden = false;
    $('g-report').hidden = false;
    $('g-report').onclick = () => reportQuestion(msg.questionId);
    $('g-timer').style.transform = 'scaleX(0)';
  }

  function onEnd(msg) {
    state.phase = 'end';
    show('s-end');
    const me = msg.ranking.find((r) => r.playerId === state.me.id);
    const won = me && me.position === 1;
    const tie = won && msg.ranking.filter((r) => r.position === 1).length > 1;
    $('end-title').textContent = tie ? '🤝 ¡Empate!' : won ? '🏆 ¡Has ganado!' : me ? `Has quedado ${me.position}º` : 'Fin de la partida';
    FX.endMascot($('s-end').querySelector('.card'), !!(me && me.position <= (msg.mode === 'duel' ? 1 : 3)));
    if (won) {
      FX.play('victory');
      FX.flash('gold');
      FX.confetti(180);
    } else if (me && me.position <= 3) {
      FX.play('streak');
      FX.confetti(50);
    } else {
      FX.play('defeat');
    }

    const list = $('end-ranking');
    list.replaceChildren();
    for (const r of msg.ranking) {
      const li = document.createElement('li');
      if (r.playerId === state.me.id) li.classList.add('me');
      const pos = document.createElement('span');
      pos.className = 'pos';
      pos.textContent = r.position <= 3 ? ['🥇', '🥈', '🥉'][r.position - 1] : r.position;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = `${r.name}${r.left ? ' (salió)' : ''}`;
      const pts = document.createElement('span');
      pts.className = 'pts';
      pts.textContent = `${r.score}`;
      li.append(pos, FX.avatar(r.name, r.avatar), name, pts);
      if (r.ratingBefore !== null && r.ratingAfter !== null) {
        const diff = r.ratingAfter - r.ratingBefore;
        const elo = document.createElement('span');
        elo.className = `elo ${diff >= 0 ? 'up' : 'down'}`;
        elo.textContent = `${diff >= 0 ? '+' : ''}${diff} ELO`;
        li.appendChild(elo);
      }
      list.appendChild(li);
    }

    const actions = $('end-actions');
    actions.replaceChildren();
    if (me) actions.appendChild(coinReward(me));
    const button = (text, cls, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = text;
      b.addEventListener('click', onClick);
      actions.appendChild(b);
      return b;
    };
    if (msg.mode === 'duel') {
      button('Otro duelo', 'btn', () => socket.send({ t: 'queue' }));
    } else if (isHost()) {
      button('Jugar otra vez', 'btn', () => socket.send({ t: 'rematch' }));
    } else {
      const note = document.createElement('p');
      note.className = 'waiting-note';
      note.textContent = 'Si el anfitrión quiere la revancha, volveréis a la sala.';
      actions.appendChild(note);
    }
    const home = document.createElement('a');
    home.className = 'btn btn-secondary';
    home.href = '/';
    home.textContent = 'Volver al inicio';
    actions.appendChild(home);
  }

  // Contador de la búsqueda de rival.
  setInterval(() => {
    if (state.phase === 'queue') $('queue-time').textContent = Math.floor((Date.now() - state.queueSince) / 1000);
  }, 500);

  // ---------- arranque ----------
  (async function init() {
    if (MODE === 'room') loadCategories();
    show('s-connecting');
    await Player.ensure();
    socket.connect();
  })();
})();
