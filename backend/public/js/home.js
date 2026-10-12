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

  loadCategories();
  loadRanking('week');
})();
