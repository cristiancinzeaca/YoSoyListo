(async function () {
  const $ = (id) => document.getElementById(id);
  await Player.ensure('Crea tu perfil para guardar tus estadísticas y aparecer en el ranking.');

  let me;
  try {
    me = await Player.refresh();
  } catch (err) {
    if (err.status === 401) {
      await Player.ensure('Tu perfil ha caducado. Elige tu nombre otra vez.');
      me = await Player.refresh();
    } else {
      document.querySelector('.container').append(Object.assign(document.createElement('p'), { className: 'error-box', textContent: err.message }));
      return;
    }
  }

  $('profile').hidden = false;
  $('name').value = me.name;
  $('p-avatar').src = FX.avatar(me.name).src;
  FX.countUp($('st-rating'), me.rating);
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

  $('rename-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('rename-error').hidden = true;
    $('rename-ok').hidden = true;
    try {
      await Player.rename($('name').value);
      $('rename-ok').hidden = false;
      $('p-avatar').src = FX.avatar($('name').value).src;
      FX.bump($('p-avatar'));
    } catch (err) {
      $('rename-error').textContent = err.message;
      $('rename-error').hidden = false;
    }
  });
})();
