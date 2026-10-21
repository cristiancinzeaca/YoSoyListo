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
