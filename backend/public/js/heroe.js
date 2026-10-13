// Página del héroe: crearlo (raza, clase, sexo), verlo, equiparlo y ver el camino de niveles.
(async function () {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  await Player.ensure('Entra con Google para crear tu héroe.');

  let bannerTimer;
  function banner(text, warn = false) {
    const b = $('banner');
    clearTimeout(bannerTimer);
    b.textContent = text;
    b.className = warn ? 'banner warn' : 'banner';
    b.hidden = false;
    bannerTimer = setTimeout(() => (b.hidden = true), 3000);
  }

  let catalog;
  let me;
  try {
    [catalog, me] = await Promise.all([api.get('/api/heroes/catalog'), api.get('/api/heroes/me')]);
  } catch (err) {
    if (err.status === 401) return Player.ensure('Tu sesión ha caducado. Vuelve a entrar con Google.');
    document.querySelector('.container').append(el('p', 'error-box', err.message));
    return;
  }

  // Adónde volver después de crear el héroe (al entrar por primera vez).
  const nextRaw = new URLSearchParams(location.search).get('next');
  const next = nextRaw && nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : null;
  if (next) $('c-later').href = next;

  // ---------- crear / cambiar ----------
  const pick = { sex: 'h', race: 'humano', cls: 'guerrero' };

  function choiceButton(container, key, value, label, sub, imgSrc) {
    const b = el('button', 'hero-choice');
    b.type = 'button';
    b.dataset.value = value;
    const img = el('img', 'hero-choice-img');
    if (imgSrc) img.src = imgSrc;
    img.alt = '';
    b.appendChild(img);
    b.appendChild(el('strong', '', label));
    if (sub) b.appendChild(el('small', '', sub));
    b.addEventListener('click', () => {
      pick[key] = value;
      paintCreate();
    });
    container.appendChild(b);
  }

  function paintCreate() {
    // Retratos de las opciones según lo elegido.
    for (const b of $('c-race').children) {
      b.classList.toggle('on', b.dataset.value === pick.race);
      b.querySelector('img').src = Hero.portraitSrc({ race: b.dataset.value, cls: pick.cls, sex: pick.sex });
    }
    for (const b of $('c-class').children) {
      b.classList.toggle('on', b.dataset.value === pick.cls);
      b.querySelector('img').src = Hero.portraitSrc({ race: pick.race, cls: b.dataset.value, sex: pick.sex });
    }
    for (const b of $('c-sex').children) b.classList.toggle('active', b.dataset.value === pick.sex);
    const preview = { name: Player.data.name, level: me.level, power: me.power, hero: { ...pick, equip: me.hero ? me.hero.equip : {}, title: me.hero ? me.hero.title : 'Novato' } };
    $('c-preview').replaceChildren(Hero.card(preview, { size: 'lg' }));
    $('c-lore').textContent = `${catalog.races[pick.race].lore} ${catalog.classes[pick.cls].lore}`;
    const changing = !!me.hero;
    const same = changing && me.hero.race === pick.race && me.hero.cls === pick.cls && me.hero.sex === pick.sex;
    $('c-go').disabled = same;
  }

  function showCreate(changing) {
    $('sheet').hidden = true;
    $('create').hidden = false;
    $('c-title').textContent = changing ? 'Cambia tu héroe' : 'Crea tu héroe';
    $('c-go').textContent = changing ? `Cambiar · 🪙 ${catalog.recreateCost}` : '⚔️ Crear mi héroe';
    $('c-cost').hidden = !changing;
    $('c-cost').textContent = changing ? 'Conservas tu nivel y todo tu equipo.' : '';
    $('c-cancel').hidden = !changing;
    $('c-later').hidden = changing;
    if (changing) Object.assign(pick, { sex: me.hero.sex, race: me.hero.race, cls: me.hero.cls });
    $('c-sex').replaceChildren();
    for (const [v, label] of [['h', 'Hombre'], ['m', 'Mujer']]) {
      const b = el('button', '', label);
      b.type = 'button';
      b.dataset.value = v;
      b.addEventListener('click', () => {
        pick.sex = v;
        paintCreate();
      });
      $('c-sex').appendChild(b);
    }
    $('c-race').replaceChildren();
    for (const [id, r] of Object.entries(catalog.races)) choiceButton($('c-race'), 'race', id, r.name, null, '');
    $('c-class').replaceChildren();
    for (const [id, c] of Object.entries(catalog.classes)) choiceButton($('c-class'), 'cls', id, c.name, null, '');
    paintCreate();
    FX.screen($('create'));
    window.scrollTo(0, 0);
  }

  $('c-go').addEventListener('click', async () => {
    $('c-error').hidden = true;
    $('c-go').disabled = true;
    try {
      const wasNew = !me.hero;
      me = await api.post('/api/heroes/me', pick);
      await Player.refresh().catch(() => {});
      if (wasNew) {
        FX.confetti && FX.confetti();
        FX.play('victory');
      }
      showSheet();
      banner(wasNew ? '¡Tu héroe está listo para la batalla!' : 'Héroe cambiado');
      if (wasNew) {
        const go = el('a', 'btn hero-go', '⚔️ ¡A jugar!');
        go.href = next || '/';
        $('h-card').after(go);
      }
    } catch (err) {
      $('c-error').textContent = err.message;
      $('c-error').hidden = false;
      $('c-go').disabled = false;
    }
  });
  $('c-cancel').addEventListener('click', () => showSheet());

  // ---------- ficha ----------
  function showSheet() {
    $('create').hidden = true;
    $('sheet').hidden = false;
    const p = { name: Player.data.name, level: me.level, power: me.power, hero: me.hero };
    $('h-card').replaceChildren(Hero.card(p, { size: 'lg', you: true }));
    $('h-lore').textContent = `${catalog.races[me.hero.race].lore} ${catalog.classes[me.hero.cls].lore}`;
    $('h-level').textContent = `Nivel ${me.level}`;
    $('h-xp').textContent = me.xpNext ? `${me.xpInto} / ${me.xpNext} XP` : 'Nivel máximo';
    $('h-xpbar').style.transform = `scaleX(${me.xpNext ? Math.min(1, me.xpInto / me.xpNext) : 1})`;
    $('h-change').textContent = `Cambiar raza, clase o sexo · 🪙 ${catalog.recreateCost}`;
    paintSlots();
    paintRoad();
    FX.screen($('sheet'));
  }

  function paintSlots() {
    const box = $('h-slots');
    box.replaceChildren();
    const unlocked = new Set(me.unlocked);
    for (const slot of catalog.slots) {
      const row = el('div', 'hero-slot');
      row.appendChild(el('h3', 'hero-slot-name', catalog.slotNames[slot]));
      const list = el('div', 'hero-items');
      const items = Object.values(catalog.items).filter((i) => i.slot === slot).sort((a, b) => a.level - b.level);
      for (const it of items) {
        const open = unlocked.has(it.id);
        const on = me.hero.equip[slot] === it.id;
        const b = el('button', `hero-item${on ? ' on' : ''}${open ? '' : ' locked'}`);
        b.type = 'button';
        b.appendChild(el('span', 'hero-item-name', it.name));
        b.appendChild(el('span', 'hero-item-meta', open ? (it.power ? `+${it.power} poder` : 'básico') : it.campaign ? '🔒 Campaña' : `🔒 Nivel ${it.level}`));
        b.disabled = !open || on;
        b.addEventListener('click', async () => {
          try {
            me = await api.post('/api/heroes/equip', { slot, item: it.id });
            showSheet();
            FX.bump(document.querySelector('#h-card .hero-portrait'));
            FX.play('correct');
          } catch (err) {
            banner(err.message, true);
          }
        });
        list.appendChild(b);
      }
      row.appendChild(list);
      box.appendChild(row);
    }
  }

  function paintRoad() {
    const road = $('h-road');
    road.replaceChildren();
    for (const step of catalog.levels) {
      if (step.level === 1) continue;
      const done = step.level <= me.level;
      const li = el('div', `hero-road-step${done ? ' done' : ''}${step.level === me.level + 1 ? ' next' : ''}`);
      li.appendChild(el('span', 'hero-road-level', String(step.level)));
      const names = step.items.map((id) => catalog.items[id].name).concat(step.unlocks.map((u) => `🔓 ${u}`));
      li.appendChild(el('span', 'hero-road-items', names.join(' · ')));
      road.appendChild(li);
    }
    const next = road.querySelector('.next');
    if (next) road.scrollTop = Math.max(0, next.offsetTop - road.offsetTop - 60);
  }

  $('h-change').addEventListener('click', () => showCreate(true));

  if (me.hero) showSheet();
  else showCreate(false);
})();
