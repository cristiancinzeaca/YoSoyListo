(function () {
  const $ = (id) => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';
  const SCREENS = ['s-connecting', 's-queue', 's-game', 's-end', 's-fatal'];

  const state = { me: null, s: null, phase: 'connecting', introDone: false, map: null, deadline: 0, duration: 1 };

  function show(id) {
    for (const s of SCREENS) $(s).hidden = s !== id;
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
    Player.clear();
    await Player.ensure('Tu perfil ha caducado. Elige tu nombre otra vez.');
    socket.connect();
  }

  function onMessage(msg) {
    if (msg.t === 'welcome') return onWelcome(msg);
    if (msg.t === 'cq_queued') return onQueued(msg);
    if (msg.t === 'cq_state') return onState(msg);
    if (msg.t === 'queue_cancelled' || msg.t === 'left') return (location.href = '/');
    if (msg.t === 'error') {
      if (msg.code === 'replaced') return fatal('Partida abierta en otra pestaña', 'Sigue jugando en la otra pestaña o dispositivo.');
      if (msg.code === 'auth') return;
      banner(msg.message, true);
    }
  }

  function onWelcome(msg) {
    banner('');
    state.me = msg.player;
    Player.save(msg.player);
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
    return p ? p.color : '#3a2d63';
  }

  function renderMap() {
    const s = state.s;
    const m = state.map;
    if (!m) return;
    const myPick = s.phase.endsWith('_pick') && s.picker === state.me.id && s.myAnswer === null;
    const target = s.attack ? s.attack.region : null;
    for (const [id, p] of Object.entries(m.paths)) {
      const owner = s.owner[id];
      p.setAttribute('fill', owner ? colorOf(owner) : '#3a2d63');
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
        g.setAttribute('class', 'castle');
        const icon = document.createElementNS(SVG, 'text');
        icon.setAttribute('x', r.cx);
        icon.setAttribute('y', r.cy - 6);
        icon.textContent = '🏰';
        const towers = document.createElementNS(SVG, 'text');
        towers.setAttribute('class', 'towers');
        towers.setAttribute('x', r.cx);
        towers.setAttribute('y', r.cy + 20);
        towers.textContent = castleOf.eliminated ? '✖' : '▮'.repeat(Math.max(0, castleOf.towers));
        g.append(icon, towers);
        m.labels.appendChild(g);
      } else if (owner && s.value[r.id]) {
        const t = document.createElementNS(SVG, 'text');
        t.setAttribute('class', 'value');
        t.setAttribute('x', r.cx);
        t.setAttribute('y', r.cy + 5);
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
    if (left > 0) requestAnimationFrame(tick);
  }

  // ---------- estado ----------
  function onState(s) {
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
  }

  function renderEnd(s) {
    state.phase = 'end';
    show('s-end');
    const ranking = s.result.ranking;
    const me = ranking.find((r) => r.playerId === state.me.id);
    const tie = me && me.position === 1 && ranking.filter((r) => r.position === 1).length > 1;
    $('end-title').textContent = tie ? '🤝 ¡Empate en cabeza!' : me && me.position === 1 ? '👑 ¡Has conquistado España!' : me ? `Has quedado ${me.position}º` : 'Fin de la partida';
    const list = $('end-ranking');
    list.replaceChildren();
    for (const r of ranking) {
      const li = el('li');
      if (r.playerId === state.me.id) li.classList.add('me');
      const dot = el('span', 'dot');
      dot.style.background = r.color;
      li.append(
        el('span', 'pos', r.position <= 3 ? ['🥇', '🥈', '🥉'][r.position - 1] : r.position),
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
    await Player.ensure('Elige el nombre que verán tus rivales.');
    socket.connect();
  })();
})();
