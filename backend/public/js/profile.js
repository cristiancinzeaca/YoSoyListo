(async function () {
  const $ = (id) => document.getElementById(id);
  await Player.ensure('Entra con Google o con tu correo para ver tu perfil, tus monedas y tus estadísticas.');

  let me;
  try {
    me = await Player.refresh();
  } catch (err) {
    if (err.status === 401) {
      await Player.ensure('Tu sesión ha caducado. Vuelve a entrar con Google.');
      return;
    } else {
      document.querySelector('.container').append(Object.assign(document.createElement('p'), { className: 'error-box', textContent: err.message }));
      return;
    }
  }

  $('profile').hidden = false;
  if (me.guest) {
    // Invitado: lo primero, guardar el progreso (y sin «cerrar sesión», que lo perdería).
    const box = document.createElement('div');
    $('profile').prepend(box);
    Player.nudgeSave(box);
    $('logout-btn').hidden = true;
  }
  $('name').value = me.name;
  $('p-avatar').src = me.hero && window.Hero ? Hero.portraitSrc(me.hero) : FX.avatar(me.name, me.avatar).src;
  $('p-hero-txt').textContent = me.hero ? `Nivel ${me.level} · ${me.hero.title} · ⚔️ ${me.power}` : 'Crea tu héroe';
  FX.countUp($('p-coins'), me.coins);
  $('logout-btn').addEventListener('click', async () => {
    await Player.logout();
    location.href = '/';
  });
  FX.countUp($('st-rating'), me.rating);
  if (me.tier) $('st-tier').textContent = `${me.tier.icon} ${me.tier.name}`;
  $('st-blitz').textContent = me.bestBlitz;
  $('st-duels').textContent = `${me.duelsWon} / ${me.duelsPlayed}`;
  $('st-rooms').textContent = `${me.roomsWon} / ${me.roomsPlayed}`;
  $('st-cq').textContent = `${me.conquistaWon} / ${me.conquistaPlayed}`;

  const list = $('history');
  for (const m of me.recentMatches) {
    const li = document.createElement('li');
    const left = document.createElement('div');
    const what =
      m.mode === 'conquista' ? 'Conquista' : m.mode === 'duel' ? (m.vsBot ? 'Duelo contra bot' : 'Duelo') : 'Sala privada';
    left.textContent = `${m.position === 1 ? '🏆' : `${m.position}º`} · ${what}`;
    const when = document.createElement('div');
    when.className = 'when';
    when.textContent = new Date(m.finishedAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
    left.appendChild(when);
    const right = document.createElement('div');
    right.textContent = `${m.score} pts`;
    if (m.ratingChange !== null) {
      const elo = document.createElement('span');
      elo.className = `elo ${m.ratingChange >= 0 ? 'up' : 'down'}`;
      elo.textContent = ` ${m.ratingChange >= 0 ? '+' : ''}${m.ratingChange}`;
      right.appendChild(elo);
    }
    li.append(left, right);
    list.appendChild(li);
  }
  $('history-empty').hidden = me.recentMatches.length > 0;

  // Nombre único: se comprueba mientras se escribe y se avisa del precio.
  const hint = $('name-hint');
  const btn = $('rename-btn');
  let checkTimer = null;
  let checkSeq = 0;
  const setHint = (text, cls = '') => {
    hint.textContent = text;
    hint.className = `name-hint ${cls}`;
  };
  const defaultHint = () =>
    setHint(me.freeRename ? 'Tu nombre es único. El primer cambio es gratis 🎁' : 'Tu nombre es único. Cambiarlo cuesta 🪙 100.');
  const checkName = async () => {
    const value = $('name').value.trim();
    const seq = ++checkSeq;
    if (value === me.name) {
      btn.disabled = true;
      return defaultHint();
    }
    try {
      const r = await api.get(`/api/players/name-check?name=${encodeURIComponent(value)}`);
      if (seq !== checkSeq) return;
      if (!r.available) {
        btn.disabled = true;
        return setHint(r.error, 'bad');
      }
      btn.disabled = false;
      setHint(
        r.cost ? `✓ Está libre · cuesta 🪙 ${r.cost}` : r.firstFree ? '✓ Está libre · ¡gratis, es tu primer cambio!' : '✓ Solo cambian mayúsculas o acentos · gratis',
        'ok'
      );
    } catch {
      btn.disabled = false;
      defaultHint();
    }
  };
  btn.disabled = true;
  $('name').addEventListener('input', () => {
    $('rename-ok').hidden = true;
    $('rename-error').hidden = true;
    clearTimeout(checkTimer);
    checkTimer = setTimeout(checkName, 350);
  });

  $('rename-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('rename-error').hidden = true;
    $('rename-ok').hidden = true;
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const player = await Player.rename($('name').value);
      me = { ...me, ...player };
      $('name').value = player.name;
      FX.countUp($('p-coins'), player.coins);
      $('rename-ok').hidden = false;
      defaultHint();
      FX.bump($('p-avatar'));
    } catch (err) {
      $('rename-error').textContent = err.message;
      $('rename-error').hidden = false;
      btn.disabled = false;
    }
  });
})();
