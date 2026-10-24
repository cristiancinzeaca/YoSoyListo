(function () {
  // Música medieval de fondo en el menú (suena tras el primer toque, como exigen los navegadores).
  if (window.FX && FX.music) FX.music.start();
  const select = document.getElementById('category');
  const rankingList = document.getElementById('ranking');
  const rankingEmpty = document.getElementById('ranking-empty');
  const tabs = document.querySelectorAll('.tab');

  const lastCategory = storage.get('ysl:category') || '';

  async function loadCategories() {
    try {
      const { categories } = await api.get('/api/questions/categories');
      for (const c of categories) {
        const opt = document.createElement('option');
        opt.value = c.category;
        opt.textContent = `${categoryLabel(c.category)} (${c.total})`;
        select.appendChild(opt);
      }
      if ([...select.options].some((o) => o.value === lastCategory)) select.value = lastCategory;
    } catch {
      // Sin categorías se puede jugar igualmente con "Todas".
    }
  }

  function row(rank, name, value, avatarKey) {
    const li = document.createElement('li');
    const pos = document.createElement('span');
    pos.className = 'pos';
    pos.textContent = rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank;
    const n = document.createElement('span');
    n.className = 'name';
    n.textContent = name;
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = value;
    li.append(pos, FX.avatar(name, avatarKey), n, pts);
    return li;
  }

  async function loadRanking(board) {
    rankingList.textContent = '';
    rankingEmpty.hidden = true;
    try {
      let rows;
      if (board === 'conquista') {
        const { entries } = await api.get('/api/players/leaderboard?mode=conquista');
        rows = entries.map((e) => row(e.rank, e.name, `${e.won} 👑`, e.avatar));
        rankingEmpty.textContent = 'Todavía nadie ha ganado una Conquista. ¡Sé el primero!';
      } else if (board === 'elo') {
        const { entries } = await api.get('/api/players/leaderboard');
        rows = entries.map((e) => row(e.rank, e.name, `${e.rating} ELO`, e.avatar));
        rankingEmpty.textContent = 'Todavía nadie ha jugado un duelo. ¡Estrénalo!';
      } else {
        const { entries } = await api.get(`/api/blitz/leaderboard?period=${board}`);
        rows = entries.map((e) => row(e.rank, e.name, `${e.score} pts`, e.avatar));
        rankingEmpty.textContent = 'Todavía no hay puntuaciones. ¡Sé el primero!';
      }
      rankingList.append(...rows);
      rankingEmpty.hidden = rows.length > 0;
    } catch {
      rankingEmpty.textContent = 'No se ha podido cargar el ranking.';
      rankingEmpty.hidden = false;
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', String(t === tab));
      });
      loadRanking(tab.dataset.board);
    });
  });

  document.getElementById('play-form').addEventListener('submit', (event) => {
    storage.set('ysl:category', select.value);
    if (!Player.has()) {
      event.preventDefault();
      const target = select.value ? `/blitz?cat=${encodeURIComponent(select.value)}` : '/blitz';
      Player.ensure(null, target).then(() => (location.href = target));
    }
  });

  const joinCode = document.getElementById('join-code');
  joinCode.addEventListener('input', () => {
    joinCode.value = joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  // Tarjeta del héroe (o invitación a crearlo).
  async function heroBanner() {
    const box = document.getElementById('hero-banner');
    if (!box || !Player.has() || !window.Hero) return;
    let me = Player.data;
    try {
      me = await Player.refresh();
    } catch {
      // con los datos guardados basta
    }
    const mk = (tag, cls, text) => {
      const e = document.createElement(tag);
      e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    };
    box.replaceChildren();
    if (!me.hero) {
      box.classList.add('empty');
      const txt = mk('span', 'hero-banner-txt');
      txt.append(mk('strong', '', '⚔️ Crea tu héroe'), mk('span', '', 'Elige raza y clase. Sube de nivel jugando y consigue armaduras que verán tus rivales.'));
      box.append(Hero.portrait(null, { size: 'sm' }), txt, mk('span', 'go', '→'));
    } else {
      const txt = mk('span', 'hero-banner-txt');
      txt.append(mk('strong', '', `${me.name} · Nivel ${me.level}`), mk('span', 'hero-title', me.hero.title), mk('span', '', `⚔️ Poder ${me.power.toLocaleString('es-ES')}`));
      box.append(Hero.portrait(me.hero, { level: me.level, size: 'sm' }), txt, mk('span', 'go', '→'));
    }
    box.hidden = false;
    // El modo +18 solo se muestra a los mayores de edad.
    const x18 = document.getElementById('x18-banner');
    if (x18) x18.hidden = !me.adult;
  }


  // ---------- liga semanal ----------
  function timeLeft(ms) {
    const h = Math.floor(ms / 3600_000);
    const d = Math.floor(h / 24);
    if (d >= 1) return `${d} ${d === 1 ? 'día' : 'días'} y ${h % 24} h`;
    if (h >= 1) return `${h} h y ${Math.floor((ms % 3600_000) / 60_000)} min`;
    return `${Math.max(1, Math.ceil(ms / 60_000))} min`;
  }

  async function loadLeague() {
    const list = document.getElementById('league-list');
    if (!list) return;
    let data;
    try {
      data = await api.get('/api/weekly');
    } catch {
      document.getElementById('league-left').textContent = 'domingo a medianoche';
      return;
    }
    document.getElementById('league-left').textContent = timeLeft(data.endsInMs);
    const fmt = (n) => Number(n).toLocaleString('es-ES');
    list.replaceChildren(
      ...data.leaderboard.slice(0, 10).map((e) => {
        const li = row(e.rank, e.name, `${fmt(e.points)} pts`, e.avatar);
        if (Player.has() && Player.data && e.playerId === Player.data.id) li.classList.add('me');
        if (e.prize) {
          const prize = document.createElement('span');
          prize.className = 'prize';
          prize.textContent = `🪙${fmt(e.prize)}`;
          li.appendChild(prize);
        }
        return li;
      })
    );
    document.getElementById('league-empty').hidden = data.leaderboard.length > 0;
    const me = document.getElementById('league-me');
    if (data.me) {
      me.hidden = false;
      me.textContent = data.me.rank
        ? `Vas ${data.me.rank}º con ${fmt(data.me.points)} puntos${data.me.rank <= 10 ? ' · ¡estás en premios!' : ''}`
        : 'Aún no has puntuado esta semana: cualquier partida cuenta.';
    }
    // Premio de la semana pasada (se enseña una vez).
    if (data.won && data.won.length) {
      const box = document.getElementById('league-won');
      const total = data.won.reduce((s, w) => s + w.coins, 0);
      const best = Math.min(...data.won.map((w) => w.rank));
      const title = document.createElement('strong');
      title.textContent = `🎉 ¡Quedaste ${best}º en la liga!`;
      const txt = document.createElement('span');
      txt.textContent = `Has ganado ${fmt(total)} monedas. Ya están en tu monedero.`;
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'btn';
      ok.textContent = '¡Genial!';
      ok.addEventListener('click', async () => {
        box.hidden = true;
        try {
          await api.post('/api/weekly/seen', {});
        } catch {
          // se volverá a enseñar la próxima vez
        }
      });
      box.replaceChildren(title, txt, ok);
      box.hidden = false;
      FX.confetti(120);
      FX.play('royalVictory');
    }
  }

  // Reto diario: racha y si ya se ha jugado hoy.
  async function retoBanner() {
    if (!Player.has()) return;
    try {
      const d = await api.get('/api/daily');
      const n = d.streak.streak;
      document.getElementById('reto-banner-title').textContent = n ? `Reto diario · 🔥 ${n} ${n === 1 ? 'día' : 'días'}` : 'Reto diario';
      document.getElementById('reto-banner-txt').textContent = d.played
        ? `Hoy: ${d.result.correct}/10 · puesto #${d.result.rank}. ¡Vuelve mañana!`
        : n
          ? '¡Juega hoy para no perder tu racha!'
          : '10 preguntas, las mismas para todos. ¿Cuántas aciertas hoy?';
      document.getElementById('reto-banner').classList.toggle('pending', !d.played);
    } catch {
      // sin datos, el texto por defecto vale
    }
  }

  Player.nudgeSave(document.getElementById('home-save'));
  loadCategories();
  loadRanking('week');
  heroBanner();
  retoBanner();
  loadLeague();
})();
