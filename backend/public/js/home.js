(function () {
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
      Player.ensure(null, select.value ? `/blitz?cat=${encodeURIComponent(select.value)}` : '/blitz');
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

  loadCategories();
  loadRanking('week');
  heroBanner();
})();
