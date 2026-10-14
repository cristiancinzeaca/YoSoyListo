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

  // ysl:sound = on (efectos) | off ; ysl:music = on | off (música de menú)
  let soundOn = store.get('ysl:sound') !== 'off';
  let musicOn = soundOn && store.get('ysl:music') !== 'off';

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


  // Ruido filtrado con forma: lowpass/highpass/bandpass.
  function noiseF(start, dur, { vol = 0.4, type = 'lowpass', freq = 900, q = 0.7, attack = 0.005, out } = {}) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + start;
    const len = Math.max(1, Math.floor(a.sampleRate * dur));
    const buf = a.createBuffer(1, len, a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource();
    src.buffer = buf;
    const filter = a.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(out || master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  // Tambor de guerra: golpe grave con caída de tono + parche.
  function drum(start, { freq = 95, vol = 0.9, decay = 0.55, out } = {}) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + start;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.8, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t + decay);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g).connect(out || master);
    osc.start(t);
    osc.stop(t + decay + 0.05);
    noiseF(start, 0.12, { vol: vol * 0.35, freq: 700, out });
  }

  // Metal contra metal (espadas, escudos).
  function clang(start, { vol = 0.35, base = 1200 } = {}) {
    [1, 1.56, 2.21, 2.76, 3.4].forEach((k, i) => tone(base * k, start, 0.5 - i * 0.07, { type: i ? 'sine' : 'triangle', vol: vol / (i + 1) }));
    noiseF(start, 0.08, { vol: vol * 0.8, type: 'highpass', freq: 3000 });
  }

  // Trompa/clarín: diente de sierra con filtro que se abre.
  function brass(freq, start, dur, { vol = 0.28, out } = {}) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + start;
    const f = a.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(freq * 1.2, t);
    f.frequency.linearRampToValueAtTime(freq * 5, t + 0.08);
    f.frequency.linearRampToValueAtTime(freq * 3, t + dur);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.05);
    g.gain.setValueAtTime(vol * 0.85, t + Math.max(0.06, dur - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    f.connect(g).connect(out || master);
    for (const det of [-6, 5]) {
      const o = a.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(freq, t);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.15);
    }
  }

  // Cuerda pulsada (laúd).
  function pluck(freq, start, { vol = 0.25, dur = 0.9, out } = {}) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + start;
    const f = a.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 6, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(out || master);
    [
      ['triangle', 1, 1],
      ['sawtooth', 1, 0.25],
      ['sine', 2, 0.3],
    ].forEach(([type, mult, level]) => {
      const o = a.createOscillator();
      const og = a.createGain();
      o.type = type;
      o.frequency.value = freq * mult;
      og.gain.value = level;
      o.connect(og).connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
  }

  const N = (semi, base = 293.66) => base * Math.pow(2, semi / 12); // semitonos desde re4

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

    // Tambores de guerra: empieza la batalla.
    battle: () => {
      [0, 0.42, 0.84, 1.05, 1.26].forEach((t, i) => drum(t, { freq: i < 3 ? 80 : 110, vol: i === 4 ? 1 : 0.8 }));
      drum(1.5, { freq: 70, vol: 1, decay: 0.9 });
      brass(N(-12), 1.5, 0.5, { vol: 0.22 });
      brass(N(-5), 1.5, 0.5, { vol: 0.18 });
      clang(1.55, { vol: 0.25 });
    },
    // Redoble corto antes de cada combate + choque de espadas.
    clash: () => {
      [0, 0.1, 0.2, 0.3].forEach((t) => drum(t, { freq: 120, vol: 0.5, decay: 0.25 }));
      clang(0.42, { vol: 0.35 });
    },
    // Cuerno: te toca.
    horn: () => {
      brass(N(-14), 0, 0.22, { vol: 0.25 });
      brass(N(-7), 0.24, 0.45, { vol: 0.28 });
    },
    // Fanfarria de inicio de partida.
    fanfare: () => {
      const seq = [[-5, 0, 0.16], [-5, 0.18, 0.16], [0, 0.36, 0.16], [4, 0.54, 0.5]];
      seq.forEach(([n, t, d]) => {
        brass(N(n), t, d, { vol: 0.24 });
        brass(N(n - 12), t, d, { vol: 0.14 });
      });
      drum(0, { freq: 90, vol: 0.6 });
      drum(0.54, { freq: 70, vol: 0.9, decay: 0.8 });
    },
    // Ganas un territorio.
    conquer: () => {
      drum(0, { freq: 100, vol: 0.7 });
      [[0, 0.05, 0.14], [4, 0.2, 0.14], [7, 0.35, 0.14], [12, 0.5, 0.55]].forEach(([n, t, d]) => {
        brass(N(n - 12), t, d, { vol: 0.24 });
        brass(N(n - 5), t, d, { vol: 0.12 });
      });
      noiseF(0.5, 0.6, { vol: 0.12, type: 'highpass', freq: 5000, attack: 0.05 });
    },
    // Pierdes un territorio.
    lost: () => {
      drum(0, { freq: 70, vol: 0.9, decay: 0.8 });
      [[3, 0, 0.3], [1, 0.32, 0.3], [0, 0.64, 0.3], [-4, 0.96, 0.8]].forEach(([n, t, d]) => brass(N(n - 12), t, d, { vol: 0.22 }));
    },
    // Ocupas una región libre (se clava la bandera).
    claim: () => {
      drum(0, { freq: 140, vol: 0.45, decay: 0.3 });
      [0, 4, 7].forEach((n, i) => pluck(N(n), 0.04 + i * 0.05, { vol: 0.22 }));
    },
    // Otro jugador ocupa o conquista (más discreto).
    other: () => {
      drum(0, { freq: 110, vol: 0.4, decay: 0.3 });
      pluck(N(-5), 0.05, { vol: 0.15 });
    },
    // Defensa: escudo.
    shield: () => {
      clang(0, { vol: 0.3, base: 700 });
      brass(N(-12), 0.1, 0.4, { vol: 0.2 });
    },
    // Castillo derrumbándose.
    crumble: () => {
      noiseF(0, 0.5, { vol: 0.9, freq: 300 });
      tone(90, 0, 0.6, { type: 'sine', vol: 0.7, slide: -50 });
      for (let i = 0; i < 9; i++) noiseF(0.25 + i * 0.09 + Math.random() * 0.05, 0.12, { vol: 0.25, type: 'bandpass', freq: 400 + Math.random() * 900, q: 3 });
      noiseF(0.2, 1.4, { vol: 0.35, freq: 220, attack: 0.2 });
    },
    royalVictory: () => {
      drum(0, { freq: 80 });
      const seq = [[0, 0, 0.15], [0, 0.17, 0.15], [0, 0.34, 0.15], [4, 0.51, 0.4], [2, 0.93, 0.15], [4, 1.1, 0.15], [7, 1.27, 0.9]];
      seq.forEach(([n, t, d]) => {
        brass(N(n), t, d, { vol: 0.24 });
        brass(N(n - 12), t, d, { vol: 0.16 });
      });
      [0.51, 1.27].forEach((t) => drum(t, { freq: 70, vol: 0.9, decay: 0.8 }));
      noiseF(1.3, 1.2, { vol: 0.12, type: 'highpass', freq: 6000, attack: 0.05 });
    },
    royalDefeat: () => {
      [[0, 0, 0.5], [-2, 0.55, 0.5], [-4, 1.1, 0.5], [-9, 1.65, 1.2]].forEach(([n, t, d]) => brass(N(n - 12), t, d, { vol: 0.2 }));
      [0, 1.65].forEach((t) => drum(t, { freq: 60, vol: 0.7, decay: 1 }));
    },
  };

  function play(name) {
    try {
      if (soundOn && SOUNDS[name]) SOUNDS[name]();
    } catch {
      /* el audio nunca debe romper el juego */
    }
  }


  // ---------- música de menú (laúd medieval en re dórico) ----------
  // [semitono desde re4 | null, duración en pasos]
  const TUNE = [
    [0, 1], [3, 1], [7, 1], [5, 1], [3, 1], [2, 1], [0, 1], [2, 1], [3, 1], [2, 1], [-2, 1], [-5, 1],
    [0, 1], [3, 1], [7, 1], [9, 1], [7, 1], [5, 1], [3, 1], [2, 1], [0, 1], [0, 2], [null, 1],
    [7, 1], [10, 1], [12, 1], [10, 1], [7, 1], [5, 1], [7, 1], [5, 1], [3, 1], [2, 2], [null, 1],
    [3, 1], [2, 1], [0, 1], [-2, 1], [2, 1], [5, 1], [3, 1], [2, 1], [-2, 1], [0, 2], [null, 1],
  ];
  const BASS = [-24, -24, -26, -29, -24, -24, -24, -24, -17, -17, -19, -21, -21, -26, -24, -24]; // una nota por compás de 3 pasos
  const STEP = 0.3;
  const music = { want: false, timer: 0, next: 0, i: 0, bar: 0, gain: null };

  function musicTick() {
    const a = ctx;
    if (!a || !music.want || !musicOn) return;
    while (music.next < a.currentTime + 0.6) {
      const startIn = music.next - a.currentTime;
      const [n, len] = TUNE[music.i];
      if (n !== null) pluck(N(n), Math.max(0, startIn), { vol: 0.2, dur: 0.6 + len * 0.3, out: music.gain });
      // bajo + pandero al empezar cada compás de 3 pasos
      const stepIndex = Math.round((music.next - music.t0) / STEP);
      if (stepIndex % 3 === 0) {
        const b = BASS[music.bar % BASS.length];
        pluck(N(b), Math.max(0, startIn), { vol: 0.24, dur: 1.4, out: music.gain });
        pluck(N(b + 7), Math.max(0, startIn) + 0.02, { vol: 0.1, dur: 1.2, out: music.gain });
        noiseF(Math.max(0, startIn), 0.08, { vol: 0.05, type: 'highpass', freq: 6500, out: music.gain });
        music.bar += 1;
      } else {
        noiseF(Math.max(0, startIn), 0.04, { vol: 0.025, type: 'highpass', freq: 8000, out: music.gain });
      }
      music.next += STEP * len;
      music.i = (music.i + 1) % TUNE.length;
    }
  }

  function musicStart() {
    music.want = true;
    if (!musicOn || music.timer) return;
    const a = audio();
    if (!a) return; // se reintenta con el primer toque del jugador
    music.gain = a.createGain();
    music.gain.gain.setValueAtTime(0.0001, a.currentTime);
    music.gain.gain.exponentialRampToValueAtTime(0.55, a.currentTime + 1.5);
    music.gain.connect(master);
    music.next = music.t0 = a.currentTime + 0.1;
    music.i = 0;
    music.bar = 0;
    music.timer = setInterval(musicTick, 200);
    musicTick();
  }

  function musicStop(keepWanted = false) {
    if (!keepWanted) music.want = false;
    if (!music.timer) return;
    clearInterval(music.timer);
    music.timer = 0;
    const g = music.gain;
    if (g && ctx) {
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      setTimeout(() => g.disconnect(), 800);
    }
    music.gain = null;
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

  // key: avatar elegido por el jugador (si lo hay); si no, uno fijo según el nombre.
  function avatar(name, key = null, cls = '') {
    const img = document.createElement('img');
    img.className = `avatar ${cls}`.trim();
    img.src = `/img/avatar-${key && ANIMALS.includes(key) ? key : avatarKey(name)}.webp`;
    img.alt = '';
    img.width = 40;
    img.height = 40;
    img.decoding = 'async';
    img.loading = 'lazy';
    return img;
  }

  // Animal del jugador (el avatar elegido o, si no, el que le toca por nombre).
  function myAnimal() {
    try {
      const d = JSON.parse(localStorage.getItem('ysl:player') || 'null');
      if (d && d.avatar && ANIMALS.includes(d.avatar)) return d.avatar;
      return avatarKey(d && d.name);
    } catch {
      return 'buho';
    }
  }

  // Mascota que asoma por la esquina: kind = 'gana' | 'falla'.
  let mascotTimer = 0;
  function mascot(kind = 'gana', { side = 'right', animal } = {}) {
    if (reduceMotion) return;
    const now = Date.now();
    if (now - mascotTimer < 1200) return;
    mascotTimer = now;
    const img = document.createElement('img');
    img.className = `fx-mascot ${side === 'left' ? 'left' : ''}`.trim();
    img.src = `/img/mascota-${kind}-${animal || myAnimal()}.webp`;
    img.alt = '';
    document.body.appendChild(img);
    setTimeout(() => img.remove(), 1600);
  }

  // Mascota grande encima de la tarjeta de resultado.
  function endMascot(card, won, animal) {
    if (!card) return;
    card.querySelector(':scope > .end-mascot')?.remove();
    const img = document.createElement('img');
    img.className = 'end-mascot';
    img.src = `/img/mascota-${won ? 'gana' : 'falla'}-${animal || myAnimal()}.webp`;
    img.alt = '';
    card.prepend(img);
  }

  // Una pantalla que aparece: entrada suave.
  const screen = (el) => retrigger(el, 'screen-in', 450);

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
      b.textContent = !soundOn ? '🔇' : musicOn ? '🎶' : '🔊';
      b.setAttribute(
        'aria-label',
        !soundOn ? 'Sonido apagado: tocar para activar música y efectos' : musicOn ? 'Música y efectos: tocar para quitar la música' : 'Solo efectos: tocar para silenciar todo'
      );
      b.title = b.getAttribute('aria-label');
    };
    paint();
    b.addEventListener('click', () => {
      // 🎶 música + efectos → 🔊 solo efectos → 🔇 nada → 🎶 …
      if (soundOn && musicOn) musicOn = false;
      else if (soundOn) soundOn = false;
      else {
        soundOn = true;
        musicOn = true;
      }
      store.set('ysl:sound', soundOn ? 'on' : 'off');
      store.set('ysl:music', musicOn ? 'on' : 'off');
      paint();
      if (musicOn && music.want) musicStart();
      else musicStop(true);
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
      if (music.want && !music.timer) setTimeout(musicStart, 0);
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

  // En segundo plano los temporizadores se frenan: mejor pausar la música.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) musicStop(true);
    else if (music.want) musicStart();
  });

  function init() {
    soundButton();
    reveal();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.FX = {
    play,
    music: { start: musicStart, stop: () => musicStop() },
    vibrate,
    confetti,
    burst,
    float,
    shake,
    bump,
    enter,
    mascot,
    endMascot,
    screen,
    myAnimal,
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
