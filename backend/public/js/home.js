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

  async function loadRanking(period) {
    rankingList.textContent = '';
    rankingEmpty.hidden = true;
    try {
      const { entries } = await api.get(`/api/blitz/leaderboard?period=${period}`);
      if (entries.length === 0) {
        rankingEmpty.hidden = false;
        return;
      }
      for (const e of entries) {
        const li = document.createElement('li');
        const pos = document.createElement('span');
        pos.className = 'pos';
        pos.textContent = e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank;
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = e.name;
        const pts = document.createElement('span');
        pts.className = 'pts';
        pts.textContent = `${e.score} pts`;
        li.append(pos, name, pts);
        rankingList.appendChild(li);
      }
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
      loadRanking(tab.dataset.period);
    });
  });

  document.getElementById('play-form').addEventListener('submit', () => {
    storage.set('ysl:category', select.value);
  });

  loadCategories();
  loadRanking('week');
})();
