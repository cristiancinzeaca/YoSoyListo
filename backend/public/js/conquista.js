(function () {
  const $ = (id) => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';
  const SCREENS = ['s-connecting', 's-queue', 's-game', 's-end', 's-fatal'];

  const state = { me: null, s: null, phase: 'connecting', introDone: false, map: null, deadline: 0, duration: 1 };

  function show(id) {
    for (const s of SCREENS) $(s).hidden = s !== id;
    if (state.shown !== id) FX.screen($(id));
    state.shown = id;
  }

  let bannerTimer;
  function banner(text, warn = false, sticky = false) {
    const el = $('banner');
    clearTimeout(bannerTimer);
    if (!text) return (el.hidden = true);
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

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // ---------- conexión ----------
  const socket = {
    ws: null,
    attempts: 0,
    stopped: false,
    connect() {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      this.ws = ws;
      ws.onopen = () => {
        this.attempts = 0;
        ws.send(JSON.stringify({ t: 'hello', token: Player.token }));
      };
      ws.onmessage = (e) => {
        try {
          onMessage(JSON.parse(e.data));
        } catch (err) {
          console.error(err);
        }
      };
      ws.onclose = (e) => {
        if (this.stopped || ws !== this.ws) return;
        if (e.code === 4001) return reauth();
        if (e.code === 4002) return;
        this.attempts += 1;
        if (state.phase !== 'end') banner('Conexión perdida. Reconectando…', true, true);
        setTimeout(() => this.connect(), Math.min(8000, 500 * 2 ** this.attempts));
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

  // ---------- comodines: 50/50 (opciones) y pista (aproximación) ----------
  const helps = {}; // texto de la pregunta → { remove, range }
  let helperWait = null;
  function requestHelper(kind) {
    return new Promise((resolve, reject) => {
      helperWait = { resolve, reject };
      socket.send({ t: 'helper', kind });
      setTimeout(() => {
        if (helperWait && helperWait.resolve === resolve) {
          helperWait = null;
          reject(new Error('Sin respuesta del servidor'));
        }
      }, 5000);
    });
  }
  const hintBar = HelperBar.create(['hint'], () => requestHelper('hint'));
  const fiftyBar = HelperBar.create(['fifty'], () => requestHelper('fifty'));

  function hintLine(range, unit) {
    const p = el('p', 'hint-line', `💡 Está entre ${fmt(range[0])} y ${fmt(range[1])}${unitLabel(unit) ? ` ${unitLabel(unit)}` : ''}`);
    p.id = 'cq-hint';
    return p;
  }

  function onHelper(msg) {
    Wallet.setCount(msg.kind, msg.left);
    if (helperWait) {
      helperWait.resolve(true);
      helperWait = null;
    }
    const h = (helps[msg.question] = { ...(helps[msg.question] || {}) });
    if (msg.remove) h.remove = msg.remove;
    if (msg.range) h.range = msg.range;
    const q = state.s && state.s.question;
    if (!q || q.text !== msg.question) return;
    if (msg.range && !$('cq-hint')) {
      const anchor = $('cq-panel').querySelector('.guess-row');
      if (anchor) anchor.after(hintLine(msg.range, q.unit));
      FX.float('💡', $('cq-panel'));
    }
    if (msg.remove) HelperBar.applyFifty([...$('cq-panel').querySelectorAll('.option')], msg.remove);
  }

  function attachBar(bar, kind, panel, q) {
    if (state.barFor !== `${kind}|${q.text}`) {
      state.barFor = `${kind}|${q.text}`;
      bar.reset();
    }
    if (helps[q.text] && helps[q.text][kind === 'hint' ? 'range' : 'remove']) bar.lock(kind);
    bar.refresh();
    panel.appendChild(bar.el);
  }

  function onMessage(msg) {
    if (msg.t === 'welcome') return onWelcome(msg);
    if (msg.t === 'cq_queued') return onQueued(msg);
    if (msg.t === 'cq_state') return onState(msg);
    if (msg.t === 'queue_cancelled' || msg.t === 'left') return (location.href = '/');
    if (msg.t === 'helper') return onHelper(msg);
    if (msg.t === 'error') {
      if (helperWait) {
        helperWait.reject(new Error(msg.message));
        helperWait = null;
        return;
      }
      if (msg.code === 'replaced') return fatal('Partida abierta en otra pestaña', 'Sigue jugando en la otra pestaña o dispositivo.');
      if (msg.code === 'auth') return;
      banner(msg.message, true);
    }
  }

  function onWelcome(msg) {
    banner('');
    state.me = msg.player;
    Player.save(msg.player);
    Wallet.load().then(() => {
      hintBar.refresh();
      fiftyBar.refresh();
    });
    if (msg.roomCode) return;
    if (state.introDone && state.phase !== 'queue' && state.phase !== 'connecting') {
      if (state.phase !== 'end') fatal('La partida se ha cortado', 'El servidor se ha reiniciado y la partida se ha perdido. ¡Lo sentimos!');
      return;
    }
    state.introDone = true;
    socket.send({ t: 'cq_queue' });
  }

  function onQueued(msg) {
    state.phase = 'queue';
    show('s-queue');
    $('q-waiting').textContent = msg.waiting;
    const secs = msg.startsInMs !== null ? Math.ceil(msg.startsInMs / 1000) : null;
    $('q-bots').textContent = secs
      ? `Si en ${secs} s no aparece nadie más, completaremos la partida con bots.`
      : 'Si no aparece nadie, completaremos la partida con bots.';
  }

  $('q-cancel').addEventListener('click', () => socket.send({ t: 'cq_cancel' }));
  $('end-again').addEventListener('click', () => {
    state.phase = 'queue';
    show('s-queue');
    socket.send({ t: 'cq_queue' });
  });

  // ---------- mapa ----------
  async function loadMap() {
    const res = await fetch('/map/espana.json');
    const map = await res.json();
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${map.width} ${map.height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Mapa de España por comunidades autónomas');
    const [[x0, y0], [x1, y1]] = map.canaryFrame;
    const frame = document.createElementNS(SVG, 'rect');
    frame.setAttribute('class', 'frame');
    frame.setAttribute('x', x0);
    frame.setAttribute('y', y0);
    frame.setAttribute('width', x1 - x0);
    frame.setAttribute('height', y1 - y0);
    frame.setAttribute('rx', 10);
    svg.appendChild(frame);

    const paths = {};
    for (const r of map.regions) {
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', r.d);
      p.setAttribute('class', 'region free');
      const title = document.createElementNS(SVG, 'title');
      title.textContent = r.name;
      p.appendChild(title);
      p.addEventListener('click', () => onRegionClick(r.id));
      svg.appendChild(p);
      paths[r.id] = p;
    }
    const labels = document.createElementNS(SVG, 'g');
    svg.appendChild(labels);
    $('cq-map').replaceChildren(svg);
    $('cq-attrib').textContent = map.attribution;
    state.map = { ...map, svg, paths, labels, byId: Object.fromEntries(map.regions.map((r) => [r.id, r])) };
  }

  function onRegionClick(region) {
    const s = state.s;
    if (!s || !s.phase.endsWith('_pick') || s.picker !== state.me.id || s.myAnswer !== null) return;
    if (!s.options.includes(region)) return;
    socket.send({ t: 'cq_pick', region });
  }

  function colorOf(id) {
    const p = state.s.players.find((x) => x.id === id);
    return p ? p.color : '#e6d3a3';
  }

  function renderMap() {
    const s = state.s;
    const m = state.map;
    if (!m) return;
    const myPick = s.phase.endsWith('_pick') && s.picker === state.me.id && s.myAnswer === null;
    const target = s.attack ? s.attack.region : null;
    for (const [id, p] of Object.entries(m.paths)) {
      const owner = s.owner[id];
      p.setAttribute('fill', owner ? colorOf(owner) : '#e6d3a3');
      p.classList.toggle('free', !owner);
      p.classList.toggle('pickable', myPick && s.options.includes(id));
      p.classList.toggle('target', id === target);
    }
    // Castillos y valores.
    m.labels.replaceChildren();
    for (const r of m.regions) {
      const owner = s.owner[r.id];
      const castleOf = s.players.find((p) => p.castle === r.id);
      if (castleOf) {
        const g = document.createElementNS(SVG, 'g');
        g.setAttribute('class', castleOf.eliminated ? 'castle dead' : 'castle');
        g.dataset.player = castleOf.id;
        const icon = document.createElementNS(SVG, 'image');
        icon.setAttribute('class', 'castle-img');
        icon.setAttribute('href', FX.castleSrc(castleOf.color));
        icon.setAttribute('x', r.cx - 55);
        icon.setAttribute('y', r.cy - 92);
        icon.setAttribute('width', 110);
        icon.setAttribute('height', 110);
        const towers = document.createElementNS(SVG, 'text');
        towers.setAttribute('class', 'towers');
        towers.setAttribute('x', r.cx);
        towers.setAttribute('y', r.cy + 40);
        towers.textContent = castleOf.eliminated ? '✖' : '▮'.repeat(Math.max(0, castleOf.towers));
        g.append(icon, towers);
        m.labels.appendChild(g);
      } else if (owner && s.value[r.id]) {
        const t = document.createElementNS(SVG, 'text');
        t.setAttribute('class', 'value');
        t.setAttribute('x', r.cx);
        t.setAttribute('y', r.cy + 11);
        t.textContent = s.value[r.id];
        m.labels.appendChild(t);
      }
    }
  }

  // ---------- jugadores ----------
  function renderPlayers() {
    const s = state.s;
    const box = $('cq-players');
    box.replaceChildren();
    const turnIds = new Set();
    if (s.picker) turnIds.add(s.picker);
    if (s.attack) {
      turnIds.add(s.attack.attackerId);
      turnIds.add(s.attack.defenderId);
    }
    for (const p of s.players) {
      const card = el('div', 'cq-player');
      card.dataset.id = p.id;
      card.appendChild(FX.avatar(p.name, p.avatar));
      if (p.id === state.me.id) card.classList.add('me');
      if (turnIds.has(p.id)) card.classList.add('turn');
      if (p.eliminated || p.left) card.classList.add('out');
      const top = el('div', 'top');
      const dot = el('span', 'dot');
      dot.style.background = p.color;
      top.append(dot, el('span', 'nm', p.name + (p.id === state.me.id ? ' (tú)' : '')));
      const sc = el('div', 'sc', p.score);
      const tw = el(
        'div',
        'tw',
        p.eliminated ? 'Eliminado' : p.left ? 'Ha salido' : !p.connected ? 'Sin conexión' : `🏰 ${'▮'.repeat(p.towers)}`
      );
      card.append(top, sc, tw);
      box.appendChild(card);
    }
  }

  const nameOf = (id) => state.s.players.find((p) => p.id === id)?.name || '?';

  // ---------- panel de acciones ----------
  function parseNumber(text) {
    let t = String(text).trim().replace(/\s/g, '');
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    const n = Number(t);
    return t !== '' && Number.isFinite(n) ? n : null;
  }

  // Para los años no hace falta mostrar la unidad («1492», no «1492 año»).
  const unitLabel = (u) => (u && u !== 'año' ? u : '');
  const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es-ES', { maximumFractionDigits: 3 }));

  function answeredChips(s) {
    const box = el('div', 'who-answered');
    box.id = 'cq-answered';
    for (const id of s.participants) {
      const chip = el('span', s.answered.includes(id) ? 'done' : '', `${nameOf(id)} ${s.answered.includes(id) ? '✓' : '…'}`);
      box.appendChild(chip);
    }
    return box;
  }

  function renderPanel() {
    const s = state.s;
    // Si solo ha cambiado quién ha respondido, no se redibuja (para no borrar lo que estás escribiendo).
    const key = [s.phase, s.round, s.question?.text, s.myAnswer, s.picker, s.options?.length, !!s.result].join('|');
    if (key === state.panelKey) {
      const chips = $('cq-answered');
      if (chips) chips.replaceWith(answeredChips(s));
      return;
    }
    state.panelKey = key;
    const panel = $('cq-panel');
    panel.replaceChildren();
    FX.enter(panel);
    const me = state.me.id;
    const q = s.question;
    const isParticipant = s.participants.includes(me);

    if (s.phase === 'intro') {
      panel.append(el('h3', '', '¡Empieza la Conquista!'), el('p', 'muted', 'Tu color es el de tu nombre arriba. Cada jugador tiene un castillo con 3 torres.'));
      return;
    }

    if (s.phase === 'exp_question' || s.phase === 'bat_tiebreak') {
      panel.append(el('div', 'question-cat', s.phase === 'bat_tiebreak' ? 'Desempate · aproximación' : 'Aproximación'));
      panel.append(el('h3', '', q.text));
      if (isParticipant && s.myAnswer === null) {
        const form = el('form', 'guess-row');
        const input = el('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.autocomplete = 'off';
        input.placeholder = 'Tu respuesta';
        const btn = el('button', 'btn', 'Enviar');
        btn.type = 'submit';
        form.append(input, btn);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const value = parseNumber(input.value);
          if (value === null) return banner('Escribe un número', true);
          socket.send({ t: 'cq_guess', value });
        });
        panel.appendChild(form);
        if (unitLabel(q.unit)) panel.appendChild(el('div', 'unit', `En ${unitLabel(q.unit)}`));
        if (helps[q.text]?.range) panel.appendChild(hintLine(helps[q.text].range, q.unit));
        attachBar(hintBar, 'hint', panel, q);
        setTimeout(() => input.focus(), 50);
      } else if (isParticipant) {
        panel.appendChild(el('p', 'muted', `Has respondido ${fmt(s.myAnswer)} ${unitLabel(q.unit)}. Esperando a los demás…`));
      } else {
        panel.appendChild(el('p', 'muted', 'Están respondiendo los jugadores en combate…'));
      }
      panel.appendChild(answeredChips(s));
      return;
    }

    if ((s.phase === 'exp_result' || s.phase === 'bat_tie_result') && s.result) {
      const r = s.result;
      panel.append(el('div', 'question-cat', 'Respuesta correcta'), el('div', 'answer-big', `${fmt(r.answer)} ${unitLabel(r.unit)}`));
      const list = el('ol', 'guesses');
      r.ranking.forEach((g, i) => {
        const li = el('li');
        const dot = el('span', 'dot');
        dot.style.background = colorOf(g.playerId);
        li.append(el('span', '', i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'), dot, el('span', 'grow', nameOf(g.playerId)));
        li.appendChild(el('span', '', g.value === null ? 'sin respuesta' : `${fmt(g.value)} (±${fmt(g.diff)})`));
        list.appendChild(li);
      });
      panel.appendChild(list);
      if (s.phase === 'exp_result') {
        panel.appendChild(el('p', 'muted', `${nameOf(r.ranking[0].playerId)} elige 2 regiones y ${nameOf(r.ranking[1].playerId)} elige 1.`));
      }
      return;
    }

    if (s.phase === 'exp_pick' || s.phase === 'bat_pick') {
      const mine = s.picker === me && s.myAnswer === null;
      const verb = s.phase === 'exp_pick' ? 'ocupar' : 'atacar';
      panel.append(
        el('h3', '', mine ? `👆 Toca en el mapa la región que quieres ${verb}` : `${nameOf(s.picker)} está eligiendo qué ${verb}…`),
        el('p', 'muted', mine ? 'Las regiones posibles parpadean en amarillo.' : 'Espera tu turno.')
      );
      return;
    }

    if (s.phase === 'bat_question' && q) {
      const a = s.attack;
      panel.append(el('div', 'question-cat', `⚔️ ${nameOf(a.attackerId)} contra ${nameOf(a.defenderId)}`), el('h3', '', q.text));
      const opts = el('div', 'options');
      q.options.forEach((text, i) => {
        const b = el('button', 'option', text);
        b.type = 'button';
        b.disabled = !isParticipant || s.myAnswer !== null;
        if (s.myAnswer === i) b.classList.add('mine');
        b.addEventListener('click', () => socket.send({ t: 'cq_choice', option: i }));
        opts.appendChild(b);
      });
      panel.appendChild(opts);
      if (isParticipant && s.myAnswer === null) {
        if (helps[q.text]?.remove) HelperBar.applyFifty([...opts.children], helps[q.text].remove);
        attachBar(fiftyBar, 'fifty', panel, q);
      }
      if (!isParticipant) panel.appendChild(el('p', 'muted', 'Tú miras este combate. ¡Piensa la respuesta!'));
      panel.appendChild(answeredChips(s));
      return;
    }

    if (s.phase === 'bat_result' && s.result) {
      const r = s.result;
      panel.append(el('div', 'question-cat', 'Resultado del combate'), el('h3', '', r.text));
      const opts = el('div', 'options');
      r.options.forEach((text, i) => {
        const b = el('button', 'option', text);
        b.type = 'button';
        b.disabled = true;
        if (i === r.correctIndex) b.classList.add('correct');
        const who = Object.entries(r.answers)
          .filter(([, v]) => v === i)
          .map(([id]) => nameOf(id));
        if (who.length && i !== r.correctIndex) b.classList.add('wrong');
        if (who.length) b.appendChild(el('span', 'tag-who', who.join(', ')));
        opts.appendChild(b);
      });
      panel.appendChild(opts);
      const outcome = {
        attacker: `¡${nameOf(state.s.attack.attackerId)} gana el combate!`,
        defender: `¡${nameOf(state.s.attack.defenderId)} se defiende!`,
        tiebreak: '¡Los dos aciertan! Habrá desempate.',
        none: 'Ninguno acierta.',
      }[r.outcome];
      panel.appendChild(el('p', 'reveal-note', (r.explanation ? `${r.explanation} · ` : '') + outcome));
      if (r.questionId) {
        const rep = el('button', 'link-btn', '⚑ Avisar de un error en esta pregunta');
        rep.type = 'button';
        rep.addEventListener('click', () => reportQuestion(r.questionId));
        panel.appendChild(rep);
      }
      return;
    }

    if (s.phase === 'bat_outcome') {
      panel.append(el('h3', '', s.event || ''));
      return;
    }
  }

  function tick() {
    const left = Math.max(0, state.deadline - performance.now());
    const bar = $('cq-timer');
    bar.style.transform = `scaleX(${state.duration ? left / state.duration : 0})`;
    bar.classList.toggle('low', left < 4000 && left > 0);
    const secs = Math.ceil(left / 1000);
    const s = state.s;
    if (s && secs <= 3 && secs > 0 && secs !== state.lastTick && s.participants.includes(state.me.id) && s.myAnswer === null && !s.phase.endsWith('_result')) {
      state.lastTick = secs;
      FX.play('tick');
    }
    if (left > 0) requestAnimationFrame(tick);
  }

  // ---------- estado ----------
  function onState(s) {
    const prev = state.s && state.s.code === s.code ? state.s : null;
    state.s = s;
    if (!state.me) return;
    if (s.phase === 'end') return renderEnd(s);
    state.phase = 'game';
    show('s-game');
    $('cq-event').textContent = s.event || '';
    renderPlayers();
    renderMap();
    // Cuando te toca responder, el mapa se encoge para que la pregunta quepa en la pantalla.
    const answering = s.participants.includes(state.me.id) && s.myAnswer === null && !s.phase.endsWith('_pick');
    const wasAnswering = $('s-game').classList.contains('answering');
    $('s-game').classList.toggle('answering', answering);
    renderPanel();
    if (answering && !wasAnswering) $('cq-panel').scrollIntoView({ behavior: 'smooth', block: 'end' });
    state.duration = s.durationMs;
    state.deadline = performance.now() + s.timeLeftMs;
    requestAnimationFrame(tick);
    try {
      effects(prev, s);
    } catch (err) {
      console.error(err);
    }
  }

  // ---------- efectos (sonido, chispas, carteles) ----------
  function regionPoint(id) {
    const p = state.map && state.map.paths[id];
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function effects(prev, s) {
    const me = state.me.id;
    const fxKey = [s.phase, s.round, s.question?.text, s.picker, !!s.result].join('|');
    const newStep = fxKey !== state.fxKey;
    state.fxKey = fxKey;
    if (!prev) return;

    // Regiones que cambian de dueño.
    let conquered = 0;
    for (const [id, owner] of Object.entries(s.owner)) {
      if (!owner || prev.owner[id] === owner) continue;
      const path = state.map.paths[id];
      if (path) {
        path.classList.remove('fx-captured');
        void path.getBoundingClientRect();
        path.classList.add('fx-captured');
      }
      const color = colorOf(owner);
      FX.burst(regionPoint(id), { colors: [color, '#ffffff', '#ffcb2b'], amount: prev.owner[id] ? 40 : 22, power: prev.owner[id] ? 9 : 6 });
      if (prev.owner[id]) conquered += 1;
      else FX.play('turn');
    }

    // Castillos: torres perdidas y eliminaciones.
    let castleFell = false;
    for (const p of s.players) {
      const before = prev.players.find((x) => x.id === p.id);
      if (!before) continue;
      if (p.towers < before.towers || (p.eliminated && !before.eliminated)) {
        castleFell = true;
        const g = state.map.labels.querySelector(`.castle[data-player="${CSS.escape(p.id)}"]`);
        if (g) {
          g.classList.add('fx-hit');
          FX.burst(g.getBoundingClientRect ? g : null, { colors: ['#ffffff', '#c9c2d9', p.color], amount: 34, power: 9 });
        }
        FX.play('boom');
        if (p.id === me) {
          FX.vibrate([120, 60, 120]);
          FX.flash('bad');
        } else FX.vibrate(60);
        if (p.eliminated && !before.eliminated) FX.bigText(p.id === me ? '💥 ¡Han tomado tu castillo!' : `💥 ¡Cae el castillo de ${p.name}!`, p.id === me ? 'bad' : '');
        else FX.bigText(p.id === me ? '¡Te han derribado una torre!' : '🏰 ¡Torre derribada!', p.id === me ? 'bad' : '');
      }
      if (p.score > before.score) {
        const sc = $('cq-players').querySelector(`.cq-player[data-id="${CSS.escape(p.id)}"] .sc`);
        FX.bump(sc);
      }
    }
    if (conquered && !castleFell) {
      FX.play('conquer');
      const attacker = s.attack ? s.attack.attackerId : prev.attack ? prev.attack.attackerId : null;
      if (attacker === me) {
        FX.vibrate([30, 30, 30]);
        FX.bigText('⚔️ ¡Conquistada!');
      }
    }

    if (!newStep) return;

    // Te toca elegir en el mapa.
    const myPick = s.phase.endsWith('_pick') && s.picker === me && s.myAnswer === null;
    if (myPick) {
      FX.play('turn');
      FX.vibrate([40, 30, 40]);
      FX.bigText(s.phase === 'exp_pick' ? '👆 ¡Elige región!' : '⚔️ ¡Elige a quién atacar!', 'cool');
    }

    // Empieza una pregunta en la que participas.
    if ((s.phase === 'exp_question' || s.phase === 'bat_question' || s.phase === 'bat_tiebreak') && s.participants.includes(me)) {
      state.lastTick = null;
      FX.play('go');
      if (s.phase === 'bat_question' && s.attack) {
        FX.bigText(s.attack.attackerId === me ? '⚔️ ¡Al ataque!' : s.attack.defenderId === me ? '🛡️ ¡Defiéndete!' : '⚔️ ¡Combate!', 'cool');
      }
    }

    // Resultado de aproximación.
    if ((s.phase === 'exp_result' || s.phase === 'bat_tie_result') && s.result && s.result.ranking.length) {
      const first = s.result.ranking[0].playerId;
      if (first === me) {
        FX.mascot('gana');
        FX.play('correct');
        FX.vibrate(30);
        FX.burst($('cq-panel'), { amount: 30 });
        FX.float('🥇 ¡El más cerca!', $('cq-panel'), 'big');
      } else if (s.result.ranking.some((g) => g.playerId === me)) {
        FX.play('wrong');
      }
    }

    // Resultado del combate.
    if (s.phase === 'bat_result' && s.result) {
      const r = s.result;
      const mine = r.answers ? r.answers[me] : undefined;
      const buttons = [...$('cq-panel').querySelectorAll('.option')];
      if (mine !== undefined && mine !== null) {
        if (mine === r.correctIndex) {
          FX.mascot('gana');
          FX.play('correct');
          FX.vibrate(25);
          FX.burst(buttons[r.correctIndex], { amount: 26 });
        } else {
          FX.mascot('falla');
          FX.play('wrong');
          FX.vibrate([60, 40, 60]);
          FX.shake($('cq-panel'));
        }
      } else if (r.outcome === 'defender') FX.play('defend');
      if (r.outcome === 'defender' && s.attack && s.attack.defenderId === me) {
        FX.float('🛡️ ¡Defendida!', $('cq-panel'), 'big');
      }
    }
  }

  function renderEnd(s) {
    state.phase = 'end';
    show('s-end');
    const ranking = s.result.ranking;
    const me = ranking.find((r) => r.playerId === state.me.id);
    const tie = me && me.position === 1 && ranking.filter((r) => r.position === 1).length > 1;
    $('end-title').textContent = tie ? '🤝 ¡Empate en cabeza!' : me && me.position === 1 ? '👑 ¡Has conquistado España!' : me ? `Has quedado ${me.position}º` : 'Fin de la partida';
    if (state.endShown !== s.code) {
      state.endShown = s.code;
      FX.endMascot($('s-end').querySelector('.card'), !!(me && me.position <= 2));
      if (me && me.position === 1) {
        FX.play('victory');
        FX.flash('gold');
        FX.confetti(220);
        setTimeout(() => FX.confetti(120), 1400);
      } else if (me && me.position === 2) {
        FX.play('streak');
        FX.confetti(50);
      } else {
        FX.play('defeat');
      }
    }
    const coinsBox = $('end-coins');
    if (coinsBox && state.coinsShown !== s.code) {
      state.coinsShown = s.code;
      coinsBox.replaceChildren(me ? coinReward(me) : '');
    }
    const list = $('end-ranking');
    list.replaceChildren();
    for (const r of ranking) {
      const li = el('li');
      if (r.playerId === state.me.id) li.classList.add('me');
      const dot = el('span', 'dot');
      dot.style.background = r.color;
      li.append(
        el('span', 'pos', r.position <= 3 ? ['🥇', '🥈', '🥉'][r.position - 1] : r.position),
        FX.avatar(r.name, r.avatar),
        dot,
        el('span', 'name', `${r.name}${r.eliminated ? ' (eliminado)' : ''}`),
        el('span', 'pts', `${r.score}`)
      );
      list.appendChild(li);
    }
  }

  (async function init() {
    show('s-connecting');
    try {
      await loadMap();
    } catch {
      return fatal('No se pudo cargar el mapa', 'Revisa tu conexión e inténtalo de nuevo.');
    }
    await Player.ensure();
    socket.connect();
  })();
})();
