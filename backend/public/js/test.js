// Test de cultura general: 20 preguntas, una a una, con nota final. Sin servidor (las preguntas vienen en la página).
(function () {
  const box = document.getElementById('test');
  const data = document.getElementById('test-data');
  if (!box || !data) return;
  const qs = JSON.parse(data.textContent);
  let i = 0;
  let score = 0;
  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  function show() {
    box.innerHTML = '';
    const q = qs[i];
    const top = h('div', 'test-top');
    top.append(h('span', 'test-step', `Pregunta ${i + 1} de ${qs.length}`), h('span', 'test-score', `✅ ${score}`));
    const bar = h('div', 'test-bar');
    const fill = h('div', 'test-fill');
    fill.style.width = `${(i / qs.length) * 100}%`;
    bar.append(fill);
    box.append(top, bar, h('p', 'test-q', q.t));
    const opts = h('div', 'test-opts');
    q.o.forEach((o) => {
      const b = h('button', 'test-opt', o);
      b.type = 'button';
      b.addEventListener('click', () => answer(b, o, opts));
      opts.append(b);
    });
    box.append(opts);
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function answer(btn, chosen, opts) {
    const q = qs[i];
    const ok = chosen === q.a;
    if (ok) score += 1;
    for (const b of opts.children) {
      b.disabled = true;
      if (b.textContent === q.a) b.classList.add('ok');
    }
    if (!ok) btn.classList.add('bad');
    const fb = h('p', `test-fb ${ok ? 'ok' : 'bad'}`, ok ? '¡Correcto!' : `Era: ${q.a}`);
    box.append(fb);
    if (q.e) box.append(h('p', 'test-expl', q.e));
    const next = h('button', 'btn', i + 1 < qs.length ? 'Siguiente →' : 'Ver mi nota');
    next.type = 'button';
    next.addEventListener('click', () => {
      i += 1;
      if (i < qs.length) show();
      else end();
    });
    box.append(next);
    next.focus({ preventScroll: true });
  }

  function verdict(n) {
    if (n >= 18) return '¡Eres listo de verdad! 🧠';
    if (n >= 15) return '¡Muy buen nivel!';
    if (n >= 10) return 'Nada mal, tienes buena base.';
    return 'Hay que practicar más… ¡pero se aprende jugando!';
  }

  function end() {
    box.innerHTML = '';
    box.append(h('p', 'test-final', `${score}/${qs.length}`), h('p', 'test-verdict', verdict(score)));
    const share = h('button', 'btn', '📣 Retar a un amigo');
    share.type = 'button';
    const url = location.origin + box.dataset.url;
    const text = `He sacado ${score}/${qs.length} en el test de Yo Soy Listo. ¿Me superas?`;
    share.addEventListener('click', async () => {
      try {
        if (navigator.share) await navigator.share({ text, url });
        else {
          await navigator.clipboard.writeText(`${text} ${url}`);
          share.textContent = '✅ Enlace copiado';
        }
      } catch (e) { /* cancelado */ }
    });
    const play = h('a', 'btn btn-secondary', '🏰 Jugar online contra otros');
    play.href = '/conquista';
    const again = h('a', 'btn btn-secondary', '🔁 Otras 20 preguntas');
    again.href = `${box.dataset.url}?s=${Math.random().toString(36).slice(2, 10)}`;
    again.rel = 'nofollow';
    box.append(share, play, again);
  }

  show();
})();
