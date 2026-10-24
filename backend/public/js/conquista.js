(function () {
  const $ = (id) => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';
  const SCREENS = ['s-connecting', 's-cq-lobby', 's-x18-gate', 's-x18-warn', 's-x18-menu', 's-x18-wait', 's-queue', 's-game', 's-end', 's-fatal'];
  // /pareja = Conquista para 2 con preguntas +18.
  // En los portales (CrazyGames) en inglés: preguntas y textos en inglés.
  const PORTAL = !!(window.YSL && YSL.portal);
  const HOME = PORTAL ? YSL.home : '/';
  const VARIANT = location.pathname.startsWith('/pareja') ? 'x18' : PORTAL && YSL.en ? 'en' : 'normal';
  const params = new URLSearchParams(location.search);
  if (VARIANT === 'x18') {
    document.body.classList.add('x18');
    document.title = 'Conquista en pareja (+18) · Yo Soy Listo';
  }

  const state = { me: null, s: null, phase: 'connecting', introDone: false, map: null, deadline: 0, duration: 1 };

  function show(id) {
    for (const s of SCREENS) $(s).hidden = s !== id;
    if (state.shown !== id) FX.screen($(id));
    state.shown = id;
    // Música medieval en los menús y la espera; en la partida, solo efectos.
    if (['s-x18-menu', 's-x18-wait', 's-queue', 's-cq-lobby'].includes(id)) FX.music.start();
    else FX.music.stop();
    document.body.classList.toggle('cq-playing', id === 's-game');
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
    if (msg.t === 'cq_private') return VARIANT === 'x18' ? onPrivate(msg) : null;
    if (msg.t === 'cq_lobby') return VARIANT === 'x18' ? null : onLobby(msg);
    if (msg.t === 'cq_lobby_closed') return fatal('Partida cancelada', msg.message || 'La partida privada se ha cerrado.');
    if (msg.t === 'cq_state') return onState(msg);
    if ((msg.t === 'queue_cancelled' || msg.t === 'left') && VARIANT === 'x18') return x18Menu();
    if (msg.t === 'queue_cancelled' || msg.t === 'left') return (location.href = HOME);
    if (msg.t === 'chat') return window.Chat && Chat.match.receive(msg.message);
    if (msg.t === 'helper') return onHelper(msg);
    if (msg.t === 'error') {
      if (helperWait) {
        helperWait.reject(new Error(msg.message));
        helperWait = null;
        return;
      }
      if (msg.code === 'replaced') return fatal('Partida abierta en otra pestaña', 'Sigue jugando en la otra pestaña o dispositivo.');
      if (msg.code === 'auth') return;
      // Enlace de amigos que ya no vale.
      if (VARIANT !== 'x18' && state.joining && state.shown === 's-connecting') return fatal('No se pudo entrar', msg.message);
      banner(msg.message, true);
      // Código equivocado o caducado: de vuelta al menú del modo +18.
      if (VARIANT === 'x18' && state.shown === 's-connecting' && state.me) show('s-x18-menu');
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
    if (msg.roomCode || msg.lobbyCode) return;
    if (state.introDone && state.phase !== 'queue' && state.phase !== 'connecting') {
      if (state.phase !== 'end') fatal('La partida se ha cortado', 'El servidor se ha reiniciado y la partida se ha perdido. ¡Lo sentimos!');
      return;
    }
    state.introDone = true;
    if (VARIANT === 'x18') return x18Start(msg.player);
    // Conquista con amigos: crear (?amigos=1) o entrar con el enlace (?c=CÓDIGO).
    const code = params.get('c');
    const friends = params.get('amigos');
    if (code || friends) {
      params.delete('c');
      params.delete('amigos');
      history.replaceState(null, '', PORTAL ? location.pathname + (YSL.lang ? `?lang=${YSL.lang}` : '') : '/conquista');
    }
    if (code) {
      state.joining = true;
      return socket.send({ t: 'cq_join', code: code.toUpperCase() });
    }
    if (friends) return socket.send({ t: 'cq_private', variant: VARIANT });
    socket.send({ t: 'cq_queue', variant: VARIANT });
  }

  // ---------- sala de espera con amigos ----------
  function onLobby(msg) {
    state.phase = 'queue';
    state.lobby = msg;
    const amHost = msg.host === state.me.id;
    $('lb-code').textContent = msg.code;
    // WhatsApp directo (en los navegadores de TikTok/Instagram no siempre hay «compartir»).
    const wa = $('lb-wa');
    if (wa) {
      wa.hidden = PORTAL || msg.host !== state.me.id;
      wa.href = `https://wa.me/?text=${encodeURIComponent(`⚔️ ¡Te reto a conquistar España! Únete a mi partida en Yo Soy Listo: ${location.origin}/conquista?c=${msg.code}`)}`;
    }
    const list = $('lb-members');
    list.replaceChildren();
    for (let i = 0; i < msg.needed; i++) {
      const m = msg.members[i];
      const li = el('li', m ? 'in' : 'empty');
      if (m) {
        li.append(FX.avatar(m.name, m.avatar), el('span', 'grow', m.name + (m.id === state.me.id ? ' (tú)' : '')));
        if (m.host) li.appendChild(el('span', 'tag', '👑 anfitrión'));
      } else {
        li.append(el('span', 'slot', '?'), el('span', 'grow', 'Esperando a un amigo…'));
      }
      list.appendChild(li);
    }
    const missing = msg.needed - msg.members.length;
    $('lb-help').textContent = amHost
      ? missing > 0
        ? `Pasa el enlace a ${missing === 1 ? 'un amigo más' : 'dos amigos'}. La partida empieza sola cuando estéis los ${msg.needed}.`
        : '¡Ya estáis todos!'
      : `Esperando a que entre${missing === 1 ? ' uno más' : 'n más amigos'} o a que el anfitrión empiece.`;
    $('lb-bots').hidden = !amHost;
    if (PORTAL) YSL.notify('room', { code: msg.code, joinable: missing > 0 });
    if (state.lastMembers !== undefined && msg.members.length > state.lastMembers) {
      FX.play('horn');
      FX.vibrate(40);
    }
    state.lastMembers = msg.members.length;
    show('s-cq-lobby');
  }
  $('lb-share').addEventListener('click', async () => {
    const code = state.lobby && state.lobby.code;
    if (!code) return;
    let url = `${location.origin}/conquista?c=${code}`;
    // En CrazyGames, el enlace de invitación lo da su SDK (abre el juego allí, en esta sala).
    if (PORTAL) url = (await YSL.inviteLink(code)) || `${location.origin}/portal/conquista?lang=${YSL.lang}&c=${code}`;
    const text = YSL && YSL.en ? '⚔️ I challenge you to conquer Spain! Join my game:' : '⚔️ ¡Te reto a conquistar España! Únete a mi partida en Yo Soy Listo:';
    try {
      if (navigator.share) await navigator.share({ title: 'Conquista con amigos', text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        banner('Enlace copiado: pégalo en WhatsApp');
      }
    } catch {
      // compartir cancelado
    }
  });
  $('lb-bots').addEventListener('click', () => socket.send({ t: 'cq_private_bot' }));
  $('lb-cancel').addEventListener('click', () => socket.send({ t: 'cq_cancel' }));

  // ---------- modo +18 ----------
  const X18_OK = 'ysl:x18-ok';
  function x18Start(player) {
    if (!player.adult) {
      state.phase = 'gate';
      return show('s-x18-gate');
    }
    if (storage.get(X18_OK) !== '1') {
      state.phase = 'menu';
      return show('s-x18-warn');
    }
    x18Menu();
  }
  function x18Menu() {
    state.phase = 'menu';
    const code = params.get('c');
    if (code) {
      params.delete('c');
      history.replaceState(null, '', '/pareja');
      state.phase = 'queue';
      show('s-connecting');
      return socket.send({ t: 'cq_join', code });
    }
    show('s-x18-menu');
  }
  if (VARIANT === 'x18') {
    $('x18-accept').addEventListener('click', () => {
      storage.set(X18_OK, '1');
      x18Menu();
    });
    $('x18-private').addEventListener('click', () => socket.send({ t: 'cq_private', variant: 'x18' }));
    $('x18-random').addEventListener('click', () => {
      state.phase = 'queue';
      show('s-queue');
      socket.send({ t: 'cq_queue', variant: 'x18' });
    });
    $('x18-join').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = $('x18-code').value.trim().toUpperCase();
      if (code) socket.send({ t: 'cq_join', code });
    });
    $('x18-code').addEventListener('input', () => {
      $('x18-code').value = $('x18-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    $('x18-bot').addEventListener('click', () => socket.send({ t: 'cq_private_bot' }));
    $('x18-cancel').addEventListener('click', () => {
      socket.send({ t: 'cq_cancel' });
    });
    $('x18-share').addEventListener('click', async () => {
      const url = `${location.origin}/pareja?c=${state.privateCode}`;
      const text = '¿Te atreves a conquistarme? 😏 Juega conmigo a Conquista en pareja (+18) en Yo Soy Listo:';
      try {
        if (navigator.share) await navigator.share({ title: 'Conquista en pareja', text, url });
        else {
          await navigator.clipboard.writeText(`${text} ${url}`);
          banner('Enlace copiado: pégalo en WhatsApp');
        }
      } catch {
        // compartir cancelado
      }
    });
  }
  function onPrivate(msg) {
    state.phase = 'queue';
    state.privateCode = msg.code;
    $('x18-mycode').textContent = msg.code;
    show('s-x18-wait');
  }

  function onQueued(msg) {
    state.phase = 'queue';
    show('s-queue');
    $('q-now').disabled = false;
    $('q-waiting').textContent = msg.waiting;
    $('q-needed').textContent = msg.needed || 3;
    if (msg.tier) $('q-tier').textContent = `Tu nivel: ${msg.tier.icon} ${msg.tier.name}`;
    // Cuenta atrás visible, segundo a segundo.
    clearInterval(state.queueTick);
    const until = msg.startsInMs !== null ? Date.now() + msg.startsInMs : null;
    const paint = () => {
      const secs = until ? Math.ceil((until - Date.now()) / 1000) : null;
      $('q-bots').textContent = secs > 0
        ? `Si en ${secs} s no aparece nadie más, completaremos la partida con bots.`
        : 'Si no aparece nadie, completaremos la partida con bots.';
      if (state.phase !== 'queue' || !(secs > 0)) clearInterval(state.queueTick);
    };
    paint();
    if (until) state.queueTick = setInterval(paint, 1000);
  }

  $('q-now').addEventListener('click', () => {
    $('q-now').disabled = true;
    socket.send({ t: 'cq_now' });
  });

  $('q-cancel').addEventListener('click', (e) => {
    e.preventDefault();
    socket.send({ t: 'cq_cancel' });
  });
  // Al acabar: sala nueva con amigos (desde ahí se envía el enlace por WhatsApp).
  $('end-friends').addEventListener('click', () => {
    state.phase = 'queue';
    show('s-connecting');
    socket.send({ t: 'cq_private', variant: VARIANT });
  });

  $('end-again').addEventListener('click', () => {
    if (VARIANT === 'x18') return x18Menu();
    // Con amigos: nueva sala para seguir con el mismo grupo.
    if (state.lobby) {
      state.phase = 'queue';
      show('s-connecting');
      return socket.send({ t: 'cq_private', variant: VARIANT });
    }
    state.phase = 'queue';
    show('s-queue');
    socket.send({ t: 'cq_queue', variant: VARIANT });
  });

  // ---------- mapa ----------
  const svgEl = (tag, attrs = {}, cls) => {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (cls) e.setAttribute('class', cls);
    return e;
  };

  // Degradado por color de jugador (más claro arriba), creado la primera vez que se usa.
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
    return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
  }
  function gradientFor(color) {
    const m = state.map;
    const key = String(color).toLowerCase();
    const id = `cq-g-${key.replace(/[^a-z0-9]/g, '')}`;
    if (!m.grads.has(id)) {
      m.grads.add(id);
      const g = svgEl('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 });
      g.append(svgEl('stop', { offset: '0', 'stop-color': /^#[0-9a-f]{6}$/.test(key) ? shade(key, 0.28) : color }));
      g.append(svgEl('stop', { offset: '1', 'stop-color': /^#[0-9a-f]{6}$/.test(key) ? shade(key, -0.22) : color }));
      m.defs.appendChild(g);
    }
    return `url(#${id})`;
  }

  async function loadMap() {
    const res = await fetch('/map/espana.json');
    const map = await res.json();
    const svg = svgEl('svg', { viewBox: `-10 -10 ${map.width + 20} ${map.height + 20}`, role: 'img', 'aria-label': 'Mapa de España por comunidades autónomas', preserveAspectRatio: 'xMidYMid meet' });
    const defs = svgEl('defs');
    const free = svgEl('linearGradient', { id: 'cq-g-free', x1: 0, y1: 0, x2: 0.3, y2: 1 });
    free.append(svgEl('stop', { offset: '0', 'stop-color': '#f7ead0' }), svgEl('stop', { offset: '1', 'stop-color': '#d8bf8c' }));
    defs.appendChild(free);
    svg.appendChild(defs);

    const [[x0, y0], [x1, y1]] = map.canaryFrame;
    svg.appendChild(svgEl('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 14 }, 'frame'));

    // Capas: espuma de la costa → grosor de la «maqueta» → regiones → brillo → castillos y cifras.
    const foam = svgEl('g', {}, 'coast');
    const base = svgEl('g', { transform: 'translate(0 9)' }, 'extrude');
    const land = svgEl('g', {}, 'land');
    const shine = svgEl('g', {}, 'shine');
    const paths = {};
    for (const r of map.regions) {
      foam.appendChild(svgEl('path', { d: r.d }));
      base.appendChild(svgEl('path', { d: r.d }));
      shine.appendChild(svgEl('path', { d: r.d, transform: 'translate(0 -1.5)' }));
      const p = svgEl('path', { d: r.d }, 'region free');
      const title = svgEl('title');
      title.textContent = r.name;
      p.appendChild(title);
      p.addEventListener('click', () => onRegionClick(r.id));
      land.appendChild(p);
      paths[r.id] = p;
    }
    const labels = svgEl('g', {}, 'labels');
    svg.append(foam, base, land, shine, labels);
    $('cq-map').replaceChildren(svg);
    $('cq-attrib').textContent = map.attribution;
    state.map = { ...map, svg, defs, grads: new Set(), paths, labels, byId: Object.fromEntries(map.regions.map((r) => [r.id, r])) };
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
      p.style.fill = owner ? gradientFor(colorOf(owner)) : 'url(#cq-g-free)';
      p.classList.toggle('free', !owner);
      p.classList.toggle('mine', owner === state.me.id);
      p.classList.toggle('pickable', myPick && s.options.includes(id));
      p.classList.toggle('target', id === target);
    }
    // Las regiones elegibles y la atacada se dibujan encima para que el borde se vea entero.
    for (const id of Object.keys(m.paths)) {
      const p = m.paths[id];
      if (p.classList.contains('pickable') || p.classList.contains('target')) p.parentNode.appendChild(p);
    }
    // Castillos, cifras y espadas.
    m.labels.replaceChildren();
    for (const r of m.regions) {
      const owner = s.owner[r.id];
      const castleOf = s.players.find((p) => p.castle === r.id);
      if (castleOf) {
        const g = svgEl('g', {}, castleOf.eliminated ? 'castle dead' : 'castle');
        g.dataset.player = castleOf.id;
        const halo = svgEl('ellipse', { cx: r.cx, cy: r.cy + 14, rx: 62, ry: 18 }, 'castle-halo');
        halo.style.fill = castleOf.color;
        g.append(svgEl('ellipse', { cx: r.cx, cy: r.cy + 16, rx: 56, ry: 15 }, 'castle-shadow'), halo);
        const icon = svgEl('image', { x: r.cx - 78, y: r.cy - 132, width: 156, height: 156 }, 'castle-img');
        icon.setAttribute('href', FX.castleSrc(castleOf.color));
        g.appendChild(icon);
        // Torres que le quedan: tres escuditos (llenos o vacíos).
        const pips = svgEl('g', {}, 'towers');
        for (let i = 0; i < 3; i++) {
          const x = r.cx - 30 + i * 30;
          const alive = !castleOf.eliminated && i < castleOf.towers;
          pips.appendChild(svgEl('path', { d: `M${x - 11},${r.cy + 22}h22v12q0,10 -11,15q-11,-5 -11,-15z` }, alive ? 'pip on' : 'pip'));
        }
        g.appendChild(pips);
        m.labels.appendChild(g);
      } else if (owner && s.value[r.id]) {
        const txt = String(s.value[r.id]);
        const w = 30 + txt.length * 23;
        const g = svgEl('g', {}, 'value');
        g.append(svgEl('rect', { x: r.cx - w / 2, y: r.cy - 26, width: w, height: 52, rx: 26 }));
        const t = svgEl('text', { x: r.cx, y: r.cy + 1 });
        t.textContent = txt;
        g.appendChild(t);
        m.labels.appendChild(g);
      }
      if (r.id === target) {
        const t = svgEl('text', { x: r.cx + (castleOf ? 52 : 0), y: r.cy - (castleOf ? 70 : 34) }, 'swords');
        t.textContent = '⚔️';
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
      card.appendChild(Hero.face(p));
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
    // En inglés la coma separa los miles (1,500) y el punto los decimales.
    if (VARIANT === 'en') t = t.replace(/,/g, '');
    else if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    const n = Number(t);
    return t !== '' && Number.isFinite(n) ? n : null;
  }

  // Para los años no hace falta mostrar la unidad («1492», no «1492 año»).
  const unitLabel = (u) => (u && u !== 'año' && u !== 'year' ? u : '');
  const LOCALE = VARIANT === 'en' ? 'en-US' : 'es-ES';
  const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString(LOCALE, { maximumFractionDigits: 3 }));

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
    const key = [s.phase, s.round, s.question?.text, s.myAnswer, s.picker, s.options?.length, !!s.result, s.myAlly?.id].join('|');
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
      panel.append(el('h3', '', '¡Empieza la Conquista!'));
      if (window.Hero) panel.append(Hero.versus(s.players, me));
      panel.append(el('p', 'muted', 'Tu color es el de tu nombre arriba. Cada jugador tiene un castillo con 3 torres.'));
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
      // Al atacar, el dueño de países puede pedir una pregunta de uno de ellos.
      if (mine && s.phase === 'bat_pick' && s.myCountries && s.myCountries.length) {
        const row = el('div', 'ally-row');
        row.appendChild(el('small', '', '🌍 Aliado: pide una pregunta de tu país'));
        for (const c of s.myCountries) {
          const b = el('button', `ally-chip${s.myAlly && s.myAlly.id === c.id ? ' on' : ''}`, `${c.flag} ${c.name}`);
          b.type = 'button';
          b.addEventListener('click', () => {
            FX.play('click');
            socket.send({ t: 'cq_ally', country: s.myAlly && s.myAlly.id === c.id ? null : c.id });
          });
          row.appendChild(b);
        }
        panel.appendChild(row);
      }
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
      if (r.questionId && VARIANT !== 'en') {
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
    if (window.Chat) Chat.match.start((m) => socket.send(m));
    const prev = state.s && state.s.code === s.code ? state.s : null;
    state.s = s;
    if (!state.me) return;
    if (s.phase === 'end') return renderEnd(s);
    if (state.phase !== 'game' && PORTAL) {
      YSL.notify('gameplayStart');
      if (state.lobby) YSL.notify('room', { code: state.lobby.code, joinable: false });
    }
    state.phase = 'game';
    show('s-game');
    $('cq-event').textContent = s.event || '';
    renderPlayers();
    renderMap();
    // La pregunta va en una hoja encima del mapa; cuando hay que elegir región, la hoja es pequeña.
    $('s-game').classList.toggle('picking', s.phase.endsWith('_pick'));
    renderPanel();
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
    if (!prev) {
      if (s.phase === 'intro') FX.play('fanfare');
      return;
    }

    // Regiones que cambian de dueño.
    let conquered = 0;
    let regionSound = null; // el más importante: lost > conquer > claim > other
    const rank = { other: 1, claim: 2, conquer: 3, lost: 4 };
    const want = (k) => {
      if (!regionSound || rank[k] > rank[regionSound]) regionSound = k;
    };
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
      if (prev.owner[id] === me) want('lost');
      else if (owner === me) want(prev.owner[id] ? 'conquer' : 'claim');
      else want('other');
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
        FX.play(p.eliminated && !before.eliminated ? 'crumble' : 'boom');
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
    if (regionSound && !castleFell) FX.play(regionSound);
    if (regionSound === 'lost' && !castleFell) FX.bigText('😩 ¡Has perdido una región!', 'bad');
    if (conquered && !castleFell) {
      const attacker = s.attack ? s.attack.attackerId : prev.attack ? prev.attack.attackerId : null;
      if (attacker === me) {
        FX.vibrate([30, 30, 30]);
        FX.bigText('⚔️ ¡Conquistada!');
      }
    }

    if (!newStep) return;

    // Empieza la fase de batalla: tambores de guerra.
    const battleStarts = s.phase.startsWith('bat_') && !prev.phase.startsWith('bat_');
    if (battleStarts) {
      FX.play('battle');
      FX.vibrate([80, 120, 80, 120, 200]);
      FX.bigText('🥁 ¡Comienza la batalla!', 'cool');
    }

    // Te toca elegir en el mapa.
    const myPick = s.phase.endsWith('_pick') && s.picker === me && s.myAnswer === null;
    if (myPick) {
      if (!battleStarts) FX.play('horn');
      FX.vibrate([40, 30, 40]);
      if (!battleStarts) FX.bigText(s.phase === 'exp_pick' ? '👆 ¡Elige región!' : '⚔️ ¡Elige a quién atacar!', 'cool');
    }

    // Empieza una pregunta en la que participas.
    if ((s.phase === 'exp_question' || s.phase === 'bat_question' || s.phase === 'bat_tiebreak') && s.participants.includes(me)) {
      state.lastTick = null;
      if (!battleStarts) FX.play(s.phase === 'bat_question' ? 'clash' : 'go');
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
      } else if (r.outcome === 'defender') FX.play('shield');
      if (r.outcome === 'defender' && s.attack && s.attack.defenderId === me) {
        FX.float('🛡️ ¡Defendida!', $('cq-panel'), 'big');
      }
    }
  }

  function renderEnd(s) {
    if (state.phase !== 'end' && PORTAL) {
      YSL.notify('gameplayStop');
      if (state.lobby) YSL.notify('leftRoom');
    }
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
        FX.play('royalVictory');
        FX.flash('gold');
        FX.confetti(220);
        setTimeout(() => FX.confetti(120), 1400);
      } else if (me && me.position === 2) {
        FX.play('streak');
        FX.confetti(50);
      } else {
        FX.play('royalDefeat');
      }
    }
    const coinsBox = $('end-coins');
    if (coinsBox && state.coinsShown !== s.code) {
      state.coinsShown = s.code;
      coinsBox.replaceChildren(me ? coinReward(me) : '');
      if (me && me.xp && window.Hero) coinsBox.appendChild(Hero.xpResult(me.xp));
    }
    $('end-friends').hidden = PORTAL || VARIANT === 'x18';
    if (state.saveShown !== s.code) {
      state.saveShown = s.code;
      Player.refresh().catch(() => {}).finally(() => Player.nudgeSave($('end-save')));
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
        Hero.face(r),
        dot,
        el('span', 'name', `${r.name}${r.eliminated ? ' (eliminado)' : ''}`),
        el('span', 'pts', `${r.score}`)
      );
      list.appendChild(li);
    }
  }

  // El mapa ocupa el hueco que deja la hoja de preguntas (como mucho la tapa un poco por abajo).
  function fitStage() {
    const stage = document.querySelector('.cq-stage');
    const sheet = document.querySelector('.cq-sheet');
    if (!stage || !sheet || !window.ResizeObserver) return;
    const apply = () => {
      const h = stage.clientHeight;
      const covered = Math.min(sheet.offsetHeight + 8, h * 0.45);
      stage.style.setProperty('--sheet-room', `${Math.round(covered)}px`);
    };
    new ResizeObserver(apply).observe(sheet);
    new ResizeObserver(apply).observe(stage);
  }
  fitStage();

  // En el portal no hay enlaces a la web (tienda, perfil): se vuelve al menú del portal.
  if (PORTAL) {
    document.querySelectorAll('a[href="/"]').forEach((a) => (a.href = HOME));
    document.querySelectorAll('#s-end a[href="/tienda"], #me-chip').forEach((a) => a.remove());
    const logo = document.querySelector('.site-header .logo');
    if (logo) logo.href = HOME;
  }

  (async function init() {
    if (PORTAL) YSL.notify('loadingStart');
    show('s-connecting');
    try {
      await loadMap();
    } catch {
      return fatal('No se pudo cargar el mapa', 'Revisa tu conexión e inténtalo de nuevo.');
    }
    try {
      await Player.ensure();
    } catch {
      return fatal('No se pudo entrar', 'Revisa tu conexión e inténtalo de nuevo.');
    }
    if (PORTAL) {
      YSL.notify('loadingStop');
      if (Player.token) YSL.notify('saveToken', { token: Player.token });
    }
    socket.connect();
  })();
})();
