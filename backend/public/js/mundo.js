// «Conquista el mundo»: comprar, estudiar, defender, fortificar y atacar países.
(function () {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const fmt = (n) => Number(n || 0).toLocaleString('es-ES');

  const state = { countries: [], mine: null, filter: 'all', me: null };

  let bannerTimer;
  function banner(text, warn = false) {
    const b = $('banner');
    clearTimeout(bannerTimer);
    b.textContent = text;
    b.className = warn ? 'banner warn' : 'banner';
    b.hidden = false;
    bannerTimer = setTimeout(() => (b.hidden = true), 3500);
  }

  function coinTag(n) {
    const s = el('span', 'coin-tag');
    const img = el('img', 'coin-img');
    img.src = '/img/ic-moneda.webp';
    img.alt = '';
    s.append(img, document.createTextNode(` ${fmt(n)}`));
    return s;
  }

  // ---------- carga ----------
  async function load() {
    const [list, mine] = await Promise.all([api.get('/api/countries'), Player.has() ? api.get('/api/countries/mine') : null]);
    state.countries = list.countries;
    state.mine = mine;
    render();
  }

  function render() {
    renderMine();
    renderGrid();
  }

  function renderMine() {
    const box = $('w-mine');
    const mine = state.mine ? state.mine.countries : [];
    box.hidden = mine.length === 0;
    if (!mine.length) return;
    const pending = mine.reduce((s, c) => s + c.pending, 0);
    $('w-pending').replaceChildren(coinTag(pending));
    $('w-collect').disabled = pending <= 0;
    const list = $('w-mine-list');
    list.replaceChildren();
    for (const c of mine) {
      const row = el('button', 'mine-row');
      row.type = 'button';
      row.append(el('span', 'flag', c.flag), el('span', 'nm', c.name));
      const meta = el('span', 'meta');
      meta.append(coinTag(c.dailyIncome), document.createTextNode('/día'));
      row.appendChild(meta);
      row.addEventListener('click', () => openCountry(c.id));
      list.appendChild(row);
    }
  }

  function shields(n, max) {
    const s = el('span', 'shields');
    for (let i = 0; i < max; i++) {
      const img = el('img', i < n ? 'on' : 'off');
      img.src = '/img/ic-escudo.webp';
      img.alt = '';
      s.appendChild(img);
    }
    return s;
  }

  function renderGrid() {
    const grid = $('w-grid');
    grid.replaceChildren();
    const meId = Player.data?.id;
    const items = state.countries.filter((c) =>
      state.filter === 'free' ? !c.owner : state.filter === 'taken' ? !!c.owner : true
    );
    items.forEach((c, i) => {
      const card = el('button', 'country-card');
      card.type = 'button';
      card.style.animationDelay = `${Math.min(i, 12) * 35}ms`;
      if (!c.owner) card.classList.add('free');
      if (c.owner && c.owner.id === meId) card.classList.add('mine');
      card.append(el('span', 'flag', c.flag), el('strong', 'nm', c.name));
      const val = el('span', 'val');
      val.appendChild(coinTag(c.owner ? c.value : c.price));
      card.appendChild(val);
      const who = el('span', 'who');
      if (c.owner) {
        who.append(FX.avatar(c.owner.name, c.owner.avatar), el('span', '', c.owner.id === meId ? 'Tuyo' : c.owner.name));
      } else {
        who.textContent = 'Libre';
      }
      card.appendChild(who);
      if (c.owner && c.maxFortify) card.appendChild(shields(c.fortify, c.maxFortify));
      card.addEventListener('click', () => openCountry(c.id));
      grid.appendChild(card);
    });
  }

  document.querySelectorAll('.world-tabs .tab').forEach((t) =>
    t.addEventListener('click', () => {
      document.querySelectorAll('.world-tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
      state.filter = t.dataset.f;
      renderGrid();
    })
  );

  $('w-collect').addEventListener('click', async () => {
    try {
      const res = await api.post('/api/countries/collect', {});
      if (res.amount > 0) {
        FX.play('victory');
        FX.burst($('w-collect'), { colors: ['#ffcb2b', '#ffe58a', '#fff'], amount: 40 });
        FX.float(`+${res.amount}`, $('w-collect'), 'big');
        Wallet.setCoins(res.coins);
      }
      await load();
    } catch (err) {
      banner(err.message, true);
    }
  });

  // ---------- ventana de un país ----------
  function sheet(contentFn) {
    document.querySelector('.overlay.sheet')?.remove();
    const overlay = el('div', 'overlay sheet');
    const card = el('div', 'card sheet-card');
    const close = el('button', 'sheet-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Cerrar');
    close.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    card.appendChild(close);
    contentFn(card, () => overlay.remove());
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    return overlay;
  }

  function openCountry(id) {
    const c = state.countries.find((x) => x.id === id);
    if (!c) return;
    const meId = Player.data?.id;
    const mine = state.mine?.countries.find((x) => x.id === id);
    sheet((card, close) => {
      const head = el('div', 'sheet-head');
      head.append(el('span', 'flag big', c.flag), el('h2', '', c.name));
      card.appendChild(head);
      const stats = el('div', 'result-stats');
      const stat = (label, node) => {
        const d = el('div');
        d.append(node, el('small', '', label));
        return d;
      };
      stats.append(
        stat(c.owner ? 'valor' : 'precio', coinTag(c.owner ? c.value : c.price)),
        stat('preguntas', el('span', '', String(c.questions))),
        stat('defensas', el('span', '', String(c.defensesWon)))
      );
      card.appendChild(stats);

      if (!c.owner) {
        card.appendChild(el('p', '', `Nadie lo tiene todavía. Te daría ${fmt(Math.floor(c.price * 0.05))} monedas al día.`));
        const b = el('button', 'btn', `Comprar por ${fmt(c.price)}`);
        b.type = 'button';
        b.addEventListener('click', () => buy(c, b, close));
        card.appendChild(b);
      } else if (c.owner.id === meId) {
        card.appendChild(el('p', '', `Es tuyo. Te da ${fmt(mine ? mine.dailyIncome : Math.floor(c.value * 0.05))} monedas al día.`));
        const study = el('button', 'btn btn-secondary', '📖 Estudiar y elegir defensa');
        study.type = 'button';
        study.addEventListener('click', () => openStudy(c.id));
        card.appendChild(study);
        if (c.fortify < c.maxFortify) {
          const f = el('button', 'btn', `🛡️ Fortificar (+5 preguntas) · ${fmt(c.price)}`);
          f.type = 'button';
          f.addEventListener('click', () => fortify(c, f));
          card.appendChild(f);
        } else {
          card.appendChild(el('p', 'center', '🛡️ Fortificado al máximo'));
        }
      } else {
        const who = el('p', 'owner-line');
        who.append(FX.avatar(c.owner.name, c.owner.avatar), document.createTextNode(` Dueño: ${c.owner.name}`));
        card.appendChild(who);
        card.appendChild(el('p', '', `Para conquistarlo tienes que acertar las ${c.questions} preguntas, con 12 segundos cada una. Si fallas una, pierdes 100 monedas y se las queda ${c.owner.name}.`));
        const a = el('button', 'btn btn-danger', '⚔️ Atacar · 100');
        a.type = 'button';
        a.addEventListener('click', () => {
          close();
          attack(c);
        });
        card.appendChild(a);
      }
    });
  }

  async function buy(c, button, close) {
    if (!Player.has()) return Player.ensure();
    button.disabled = true;
    try {
      const res = await api.post(`/api/countries/${c.id}/buy`, {});
      Wallet.setCoins(res.coins);
      close();
      FX.play('victory');
      FX.confetti(140);
      FX.bigText(`${c.flag} ¡${c.name} es tuyo!`);
      await load();
    } catch (err) {
      FX.play('wrong');
      banner(err.message, true);
      button.disabled = false;
    }
  }

  async function fortify(c, button) {
    button.disabled = true;
    try {
      const res = await api.post(`/api/countries/${c.id}/fortify`, {});
      Wallet.setCoins(res.coins);
      FX.play('defend');
      FX.bigText('🛡️ ¡Fortificado!', 'cool');
      await load();
      openStudy(c.id);
    } catch (err) {
      banner(err.message, true);
      button.disabled = false;
    }
  }

  // ---------- estudiar y elegir defensa ----------
  async function openStudy(id) {
    let data;
    try {
      data = await api.get(`/api/countries/${id}/study`);
    } catch (err) {
      return banner(err.message, true);
    }
    sheet((card, close) => {
      const head = el('div', 'sheet-head');
      head.append(el('span', 'flag big', data.flag), el('h2', '', `Preguntas de ${data.name}`));
      card.appendChild(head);
      const need = data.defenseSize;
      const counter = el('p', 'pick-count');
      card.appendChild(el('p', '', `Las 10 fijas siempre defienden el país. Elige otras ${need} para completar la defensa. ¡Estúdialas!`));
      card.appendChild(counter);
      const picked = new Set(data.questions.filter((q) => q.defense).map((q) => q.seq));
      const list = el('ul', 'study-list');
      const save = el('button', 'btn', 'Guardar defensa');
      save.type = 'button';
      const paint = () => {
        counter.textContent = `Elegidas: ${picked.size} de ${need}`;
        counter.classList.toggle('ok', picked.size === need);
        save.disabled = picked.size !== need;
      };
      for (const q of data.questions) {
        const li = el('li', q.base ? 'base' : '');
        const text = el('div', 'q', q.text);
        const ans = el('div', 'a', `✔ ${q.answer}`);
        li.append(text, ans);
        if (q.base) {
          li.appendChild(el('span', 'tag', 'Fija'));
        } else {
          const box = el('input');
          box.type = 'checkbox';
          box.checked = picked.has(q.seq);
          box.setAttribute('aria-label', 'Usar en la defensa');
          box.addEventListener('change', () => {
            if (box.checked) {
              if (picked.size >= need) {
                box.checked = false;
                FX.shake(counter);
                return;
              }
              picked.add(q.seq);
            } else picked.delete(q.seq);
            paint();
          });
          li.prepend(box);
        }
        list.appendChild(li);
      }
      card.appendChild(list);
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          await api.post(`/api/countries/${id}/defense`, { seqs: [...picked] });
          FX.play('correct');
          banner('Defensa guardada');
          close();
        } catch (err) {
          banner(err.message, true);
          save.disabled = false;
        }
      });
      card.appendChild(save);
      paint();
    });
  }

  // ---------- atacar ----------
  async function attack(c) {
    if (!Player.has()) return Player.ensure();
    let start;
    try {
      start = await api.post(`/api/countries/${c.id}/attack`, {});
    } catch (err) {
      FX.play('wrong');
      return banner(err.message, true);
    }
    Wallet.setCoins(start.coins);
    const overlay = el('div', 'overlay attack-screen');
    const card = el('div', 'card attack-card');
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    FX.play('go');
    FX.bigText(`⚔️ ¡Al ataque, ${c.flag} ${c.name}!`, 'cool');

    let timerRaf = 0;
    let busy = false;
    const finish = (title, text, won) => {
      cancelAnimationFrame(timerRaf);
      card.replaceChildren();
      FX.endMascot(card, won);
      card.append(el('h1', 'end-title', title), el('p', 'center', text));
      const b = el('button', 'btn', 'Volver al mapa');
      b.type = 'button';
      b.addEventListener('click', async () => {
        overlay.remove();
        await load();
      });
      card.appendChild(b);
      FX.screen(card);
    };

    const showQuestion = (q) => {
      busy = false;
      card.replaceChildren();
      const top = el('div', 'attack-top');
      top.append(el('span', 'flag', c.flag), el('strong', '', `Pregunta ${q.index + 1} de ${q.total}`));
      const timer = el('div', 'timer');
      const bar = el('div', 'timer-bar');
      timer.appendChild(bar);
      const prog = el('div', 'attack-progress');
      for (let i = 0; i < q.total; i++) prog.appendChild(el('span', i < q.index ? 'done' : i === q.index ? 'now' : ''));
      card.append(top, prog, timer, el('div', 'question-text', q.text));
      const opts = el('div', 'options');
      q.options.forEach((text, i) => {
        const b = el('button', 'option', text);
        b.type = 'button';
        b.addEventListener('click', () => answer(q, i, b, opts));
        opts.appendChild(b);
      });
      card.appendChild(opts);
      FX.enter(card);
      const endAt = performance.now() + q.ms;
      let lastTick = null;
      const tick = () => {
        const left = Math.max(0, endAt - performance.now());
        bar.style.transform = `scaleX(${left / q.ms})`;
        bar.classList.toggle('low', left < 4000);
        const secs = Math.ceil(left / 1000);
        if (secs <= 3 && secs > 0 && secs !== lastTick) {
          lastTick = secs;
          FX.play('tick');
        }
        if (left > 0) timerRaf = requestAnimationFrame(tick);
        else if (!busy) answer(q, -1, null, opts);
      };
      timerRaf = requestAnimationFrame(tick);
    };

    const answer = async (q, i, button, opts) => {
      if (busy) return;
      busy = true;
      cancelAnimationFrame(timerRaf);
      [...opts.children].forEach((b) => (b.disabled = true));
      if (button) button.classList.add('mine');
      let res;
      try {
        res = await api.post(`/api/countries/attacks/${start.attackId}/answer`, { index: q.index, option: i });
      } catch (err) {
        return finish('Algo ha fallado', err.message, false);
      }
      if (res.result === 'next') {
        if (button) {
          button.classList.remove('mine');
          button.classList.add('correct');
          FX.burst(button, { amount: 14, power: 5 });
        }
        FX.play('correct');
        setTimeout(() => showQuestion(res.question), 450);
      } else if (res.result === 'won') {
        FX.play('victory');
        FX.flash('gold');
        FX.confetti(220);
        finish(`👑 ¡${c.name} es tuyo!`, `Has acertado las ${res.total} preguntas. El antiguo dueño recibe una indemnización y tú empiezas a cobrar sus rentas.`, true);
      } else if (res.result === 'changed') {
        finish('El país cambió de manos', 'Mientras atacabas, el país ha cambiado de dueño. Inténtalo de nuevo.', false);
      } else {
        if (button) {
          button.classList.remove('mine');
          button.classList.add('wrong');
        }
        FX.play('boom');
        FX.vibrate([120, 60, 120]);
        FX.shake(card);
        setTimeout(
          () =>
            finish(
              '🛡️ ¡Ataque rechazado!',
              `${res.reason === 'timeout' ? 'Se te acabó el tiempo' : 'Fallaste'} en la pregunta ${res.at + 1} de ${res.total}. Tus 100 monedas son ahora del dueño. Podrás volver a intentarlo mañana.`,
              false
            ),
          700
        );
      }
    };

    showQuestion(start.question);
  }

  (async function init() {
    try {
      await load();
      const open = new URLSearchParams(location.search).get('p');
      if (open) openCountry(open);
    } catch (err) {
      banner(err.message, true);
    }
  })();
})();
