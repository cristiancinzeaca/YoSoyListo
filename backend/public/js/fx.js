// Efectos de juego: sonidos sintetizados, vibración, confeti, chispas y avatares.
// Todo es local (sin archivos de audio ni librerías externas) para respetar la CSP.
(function () {
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* sin almacenamiento: el ajuste dura solo esta visita */
      }
    },
  };

  let soundOn = store.get('ysl:sound') !== 'off';

  // ---------- sonido ----------
  let ctx = null;
  let master = null;
  function audio() {
    if (!soundOn) return null;
    // Los navegadores no dejan sonar nada hasta que el jugador toca la página.
    if (!ctx && navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Una nota con envolvente corta. type: sine | square | triangle | sawtooth
  function tone(freq, start, dur, { type = 'triangle', vol = 0.5, slide = 0 } = {}) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + start;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise(start, dur, { vol = 0.4, freq = 900 } = {}) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + start;
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource();
    src.buffer = buf;
    const filter = a.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const g = a.createGain();
    g.gain.value = vol;
    src.connect(filter).connect(g).connect(master);
    src.start(t);
  }

  const SOUNDS = {
    click: () => tone(660, 0, 0.06, { type: 'square', vol: 0.12 }),
    tick: () => tone(880, 0, 0.05, { type: 'square', vol: 0.15 }),
    go: () => {
      tone(523, 0, 0.12, { vol: 0.4 });
      tone(1046, 0.1, 0.25, { vol: 0.4 });
    },
    correct: () => {
      tone(659, 0, 0.1, { vol: 0.45 });
      tone(880, 0.08, 0.1, { vol: 0.45 });
      tone(1318, 0.16, 0.22, { vol: 0.4 });
    },
    wrong: () => {
      tone(220, 0, 0.18, { type: 'sawtooth', vol: 0.25, slide: -60 });
      tone(160, 0.14, 0.28, { type: 'sawtooth', vol: 0.25, slide: -50 });
    },
    streak: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.06, 0.12, { type: 'square', vol: 0.18 })),
    turn: () => {
      tone(784, 0, 0.1, { vol: 0.35 });
      tone(988, 0.12, 0.18, { vol: 0.35 });
    },
    conquer: () => {
      noise(0, 0.25, { vol: 0.35, freq: 1400 });
      [392, 523, 659, 784].forEach((f, i) => tone(f, 0.05 + i * 0.08, 0.16, { type: 'square', vol: 0.2 }));
    },
    defend: () => {
      tone(330, 0, 0.12, { type: 'square', vol: 0.25 });
      tone(330, 0.15, 0.25, { type: 'square', vol: 0.25 });
    },
    boom: () => {
      noise(0, 0.6, { vol: 0.8, freq: 400 });
      tone(110, 0, 0.5, { type: 'sine', vol: 0.6, slide: -70 });
    },
    victory: () => {
      const n = [523, 523, 523, 659, 784, 659, 784, 1046];
      const d = [0.12, 0.12, 0.12, 0.3, 0.15, 0.12, 0.15, 0.6];
      let t = 0;
      n.forEach((f, i) => {
        tone(f, t, d[i] + 0.05, { type: 'square', vol: 0.22 });
        tone(f / 2, t, d[i] + 0.05, { type: 'triangle', vol: 0.25 });
        t += d[i];
      });
    },
    defeat: () => [392, 370, 349, 262].forEach((f, i) => tone(f, i * 0.22, 0.3, { type: 'triangle', vol: 0.35 })),
  };

  function play(name) {
    try {
      if (soundOn && SOUNDS[name]) SOUNDS[name]();
    } catch {
      /* el audio nunca debe romper el juego */
    }
  }

  function vibrate(pattern) {
    if (soundOn && navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch {
        /* ignorado */
      }
    }
  }

  // ---------- capa de partículas ----------
  let canvas = null;
  let c2d = null;
  let parts = [];
  let raf = 0;
  const COLORS = ['#ffcb2b', '#7c4dff', '#ffffff', '#e5484d', '#3e8ef7', '#2fbf71', '#ff8bd1'];

  function layer() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'fx-layer';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    c2d = canvas.getContext('2d');
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    addEventListener('resize', resize);
  }

  function loop() {
    c2d.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter((p) => p.life > 0);
    for (const p of parts) {
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life -= 1;
      const alpha = Math.min(1, p.life / 20);
      c2d.save();
      c2d.globalAlpha = alpha;
      c2d.translate(p.x, p.y);
      c2d.rotate(p.rot);
      c2d.fillStyle = p.color;
      if (p.shape === 'star') {
        c2d.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? p.size * 0.45 : p.size;
          const a = (i * Math.PI) / 5;
          c2d.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        c2d.closePath();
        c2d.fill();
      } else if (p.shape === 'dot') {
        c2d.beginPath();
        c2d.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        c2d.fill();
      } else {
        c2d.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      c2d.restore();
    }
    if (parts.length) raf = requestAnimationFrame(loop);
    else {
      raf = 0;
      c2d.clearRect(0, 0, innerWidth, innerHeight);
    }
  }

  function spawn(list) {
    if (reduceMotion) return;
    layer();
    parts.push(...list);
    if (!raf) raf = requestAnimationFrame(loop);
  }

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // Lluvia de confeti desde arriba (victoria).
  function confetti(amount = 140) {
    const list = [];
    for (let i = 0; i < amount; i++) {
      list.push({
        x: rand(0, innerWidth),
        y: rand(-innerHeight * 0.5, -10),
        vx: rand(-2, 2),
        vy: rand(2, 6),
        g: 0.06,
        drag: 0.995,
        rot: rand(0, 6),
        vr: rand(-0.2, 0.2),
        size: rand(7, 13),
        color: pick(COLORS),
        shape: Math.random() < 0.2 ? 'star' : 'rect',
        life: rand(160, 260),
      });
    }
    spawn(list);
  }

  // Explosión de chispas en un punto o sobre un elemento.
  function burst(target, { colors = ['#ffcb2b', '#ffffff', '#7c4dff'], amount = 26, power = 7 } = {}) {
    let x;
    let y;
    if (target && target.getBoundingClientRect) {
      const r = target.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    } else if (target) {
      ({ x, y } = target);
    } else {
      x = innerWidth / 2;
      y = innerHeight / 2;
    }
    const list = [];
    for (let i = 0; i < amount; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(power * 0.4, power);
      list.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 2,
        g: 0.18,
        drag: 0.94,
        rot: rand(0, 6),
        vr: rand(-0.3, 0.3),
        size: rand(5, 11),
        color: pick(colors),
        shape: Math.random() < 0.5 ? 'star' : 'dot',
        life: rand(35, 60),
      });
    }
    spawn(list);
  }

  // Texto flotante («+200», «¡Racha!») sobre un elemento.
  function float(text, target, cls = '') {
    if (!target) return;
    const r = target.getBoundingClientRect();
    const f = document.createElement('div');
    f.className = `fx-float ${cls}`.trim();
    f.textContent = text;
    f.style.left = `${r.left + r.width / 2}px`;
    f.style.top = `${r.top + r.height / 2}px`;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 1300);
  }

  function retrigger(el, cls, ms = 600) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }

  const shake = (el) => retrigger(el, 'fx-shake', 500);
  const bump = (el) => retrigger(el, 'fx-bump', 450);
  const enter = (el) => retrigger(el, 'fx-in', 400);

  // Destello de pantalla completa: 'ok' (verde), 'bad' (rojo) o 'gold'.
  function flash(kind = 'ok') {
    if (reduceMotion) return;
    const f = document.createElement('div');
    f.className = `fx-flash ${kind}`;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 600);
  }

  // Cartel grande en el centro («¡Tu turno!», «¡Castillo destruido!»).
  function bigText(text, cls = '') {
    const f = document.createElement('div');
    f.className = `fx-big ${cls}`.trim();
    f.textContent = text;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 1500);
  }

  // Cuenta animada de un número (pantallas de resultado).
  function countUp(el, to, ms = 900) {
    if (!el) return;
    to = Number(to) || 0;
    if (reduceMotion || to === 0) {
      el.textContent = to;
      return;
    }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- avatares ----------
  const ANIMALS = ['buho', 'zorro', 'gato', 'loro', 'toro', 'tortuga', 'erizo', 'mapache'];
  const BOT_AVATAR = {
    Einstein: 'buho',
    Curie: 'zorro',
    Cervantes: 'gato',
    Frida: 'loro',
    Lorca: 'toro',
    Hipatia: 'tortuga',
    'Ramón y Cajal': 'erizo',
    Lovelace: 'mapache',
  };

  function avatarKey(name) {
    const n = String(name || '');
    const base = n.replace(/^🤖\s*/, '').trim(); // «🤖 Curie» → Curie
    if (BOT_AVATAR[base]) return BOT_AVATAR[base];
    let h = 0;
    for (const ch of n.toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return ANIMALS[h % ANIMALS.length];
  }

  function avatar(name, cls = '') {
    const img = document.createElement('img');
    img.className = `avatar ${cls}`.trim();
    img.src = `/img/avatar-${avatarKey(name)}.webp`;
    img.alt = '';
    img.width = 40;
    img.height = 40;
    img.decoding = 'async';
    img.loading = 'lazy';
    return img;
  }

  const CASTLE_BY_COLOR = { '#e5484d': 'rojo', '#3e8ef7': 'azul', '#2fbf71': 'verde' };
  const castleSrc = (color) => `/img/castillo-${CASTLE_BY_COLOR[String(color).toLowerCase()] || 'rojo'}.webp`;

  // ---------- botón de sonido en la cabecera ----------
  function soundButton() {
    const header = document.querySelector('.site-header');
    if (!header || header.querySelector('.sound-btn')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sound-btn';
    const paint = () => {
      b.textContent = soundOn ? '🔊' : '🔇';
      b.setAttribute('aria-label', soundOn ? 'Silenciar sonidos y vibración' : 'Activar sonidos y vibración');
      b.setAttribute('aria-pressed', String(!soundOn));
    };
    paint();
    b.addEventListener('click', () => {
      soundOn = !soundOn;
      store.set('ysl:sound', soundOn ? 'on' : 'off');
      paint();
      play('click');
    });
    const chip = header.querySelector('.me-chip');
    const group = document.createElement('div');
    group.className = 'header-actions';
    if (chip) {
      chip.replaceWith(group);
      group.append(b, chip);
    } else {
      group.append(b);
      header.appendChild(group);
    }
  }

  // Sonido de clic para todos los botones del juego.
  document.addEventListener(
    'pointerdown',
    (e) => {
      const t = e.target.closest && e.target.closest('.btn, .option:not(:disabled), .tab, .seg button, .sound-btn');
      if (t && !t.classList.contains('sound-btn')) play('click');
    },
    { passive: true }
  );

  // Animación de entrada escalonada para tarjetas.
  function reveal() {
    const items = document.querySelectorAll('.modes > .card, main > .card, .rules');
    items.forEach((el, i) => {
      el.classList.add('fx-enter');
      el.style.animationDelay = `${Math.min(i, 8) * 70}ms`;
    });
  }

  function init() {
    soundButton();
    reveal();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.FX = {
    play,
    vibrate,
    confetti,
    burst,
    float,
    shake,
    bump,
    enter,
    flash,
    bigText,
    countUp,
    avatar,
    avatarKey,
    castleSrc,
    get soundOn() {
      return soundOn;
    },
    reduceMotion,
  };
})();
