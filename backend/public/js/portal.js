// Menú del portal (CrazyGames…): un botón para jugar ya, idioma y cómo se juega.
(function () {
  const $ = (id) => document.getElementById(id);
  const t = YSL.t;
  document.title = t('Yo Soy Listo · Conquista de preguntas', 'Yo Soy Listo · Trivia Conquest');
  $('p-title').textContent = t('🏰 ¡Conquista España!', '🏰 Conquer Spain!');
  $('p-sub').textContent = t(
    'Juego de preguntas online para 3 jugadores. Responde, gana regiones y derriba los castillos rivales.',
    'Online trivia for 3 players. Answer questions, win regions and knock down your rivals’ castles.'
  );
  $('p-play').textContent = t('▶ JUGAR', '▶ PLAY');
  $('p-play').href = `/portal/conquista?lang=${YSL.lang}`;
  $('p-friends').textContent = t('👥 Jugar con amigos', '👥 Play with friends');
  $('p-friends').href = `/portal/conquista?lang=${YSL.lang}&amigos=1`;
  // Invitación de un amigo (?room=) o multijugador instantáneo del portal (?instant=1): directos a la sala.
  const q = new URLSearchParams(location.search);
  const room = String(q.get('room') || '').toUpperCase();
  if (/^[A-Z0-9]{3,12}$/.test(room)) return location.replace(`/portal/conquista?lang=${YSL.lang}&c=${room}`);
  if (q.get('instant') === '1') return location.replace(`/portal/conquista?lang=${YSL.lang}&amigos=1`);
  const how = YSL.en
    ? ['🎯 Closest number wins the first pick of regions.', '⚔️ Attack neighbours with multiple-choice questions.', '🏰 Take all 3 towers of a castle to take all its land.']
    : ['🎯 El que más se acerca elige primero las regiones.', '⚔️ Ataca a tus vecinos con preguntas de opciones.', '🏰 Derriba las 3 torres de un castillo y quédate con todo.'];
  $('p-how').replaceChildren(
    ...how.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    })
  );
  for (const b of document.querySelectorAll('.portal-lang button')) {
    b.classList.toggle('active', b.dataset.lang === YSL.lang);
    b.addEventListener('click', () => {
      if (b.dataset.lang === YSL.lang) return;
      YSL.setLang(b.dataset.lang);
      location.replace(`/portal?lang=${b.dataset.lang}`);
    });
  }
  YSL.notify('loadingStop');
})();
