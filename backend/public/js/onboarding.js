// Tutorial de bienvenida: 4 pasos la primera vez que se abre el juego. Se puede saltar y volver a ver.
(function () {
  const KEY = 'ysl_onboarded_v1';
  const STEPS = [
    { img: '/img/hero.webp', title: '¡Bienvenido a Yo Soy Listo!', text: 'El juego de preguntas para demostrar lo que sabes. Es gratis y puedes empezar ya, sin registrarte.' },
    { img: '/img/modo-conquista.webp', title: '🏰 Conquista España', text: 'Primero os repartís el mapa: quien más se acerque a la respuesta elige comunidades. Después atacáis comunidades vecinas por turnos. Cada castillo aguanta 3 ataques.' },
    { img: '/img/modo-blitz.webp', title: '⚡ Blitz y ⚔️ Duelos', text: 'Blitz: 60 segundos para acertar todas las que puedas; las rachas multiplican tus puntos. En los duelos, la misma pregunta para los dos y 15 segundos: cuanto más rápido aciertes, más puntos.' },
    { img: '/img/mascota-gana-zorro.webp', title: '🪙 Monedas y comodines', text: 'Cada partida te da monedas. Úsalas en la tienda para comprar comodines (50/50, tiempo extra, saltar, pista) y avatares. ¡Y no te pierdas el reto diario!' },
  ];
  const seen = () => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return true; } };
  const markSeen = () => { try { localStorage.setItem(KEY, '1'); } catch (e) { /* sin almacenamiento */ } };

  function open() {
    let i = 0;
    const wrap = document.createElement('div');
    wrap.className = 'onb';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = '<div class="onb-card card"><button type="button" class="onb-skip">Saltar</button><img class="onb-img" alt=""><h2 class="onb-title"></h2><p class="onb-text"></p><div class="onb-dots"></div><button type="button" class="btn onb-next"></button></div>';
    document.body.appendChild(wrap);
    const $ = (s) => wrap.querySelector(s);
    const close = () => { markSeen(); wrap.remove(); };
    function render() {
      const s = STEPS[i];
      $('.onb-img').src = s.img;
      $('.onb-title').textContent = s.title;
      $('.onb-text').textContent = s.text;
      $('.onb-dots').innerHTML = STEPS.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('');
      $('.onb-next').textContent = i < STEPS.length - 1 ? 'Siguiente →' : '¡A jugar!';
    }
    $('.onb-skip').addEventListener('click', close);
    $('.onb-next').addEventListener('click', () => { if (i < STEPS.length - 1) { i += 1; render(); } else close(); });
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
    render();
    $('.onb-next').focus();
  }

  window.YSLOnboarding = { open };
  const again = document.getElementById('onb-again');
  if (again) again.addEventListener('click', open);
  if (!seen()) open();
})();
