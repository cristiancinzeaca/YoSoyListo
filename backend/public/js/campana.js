// Campaña «Las Crónicas de Sapiencia»: mapa de capítulos, escenas y combates.
(async function () {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  await Player.ensure('Entra con Google o con tu correo para empezar la aventura.');

  let bannerTimer;
  function banner(text, warn = false) {
    const b = $('banner');
    clearTimeout(bannerTimer);
    b.textContent = text;
    b.className = warn ? 'banner warn' : 'banner';
    b.hidden = false;
    bannerTimer = setTimeout(() => (b.hidden = true), 3200);
  }

  const SCREENS = ['s-map', 's-chapter', 's-story', 's-battle'];
  function show(id) {
    for (const s of SCREENS) $(s).hidden = s !== id;
    document.documentElement.classList.toggle('lore-full', id === 's-story' || id === 's-battle');
    FX.screen($(id));
    window.scrollTo(0, 0);
  }

  let data = null;
  let chapter = null;
  const me = () => Player.data || {};
  const fill = (text) => String(text).replaceAll('{nombre}', me().name || 'héroe');

  async function load() {
    data = await api.get('/api/campaign');
    if (chapter) chapter = data.chapters.find((c) => c.id === chapter.id) || null;
  }

  // ---------- mapa ----------
  function chapterCard(ch) {
    const card = el('button', `lore-card${ch.unlocked ? '' : ' locked'}${ch.done ? ' done' : ''}`);
    card.type = 'button';
    const bg = el('span', 'lore-card-bg');
    bg.style.backgroundImage = `url("${ch.img}")`;
    card.appendChild(bg);
    const txt = el('span', 'lore-card-txt');
    txt.append(el('strong', '', ch.title), el('span', '', ch.place));
    const doneCount = ch.nodes.filter((n) => n.done).length;
    const bar = el('span', 'lore-card-progress');
    const fillBar = el('span');
    fillBar.style.transform = `scaleX(${doneCount / ch.nodes.length})`;
    bar.appendChild(fillBar);
    txt.appendChild(bar);
    card.appendChild(txt);
    card.appendChild(el('span', 'lore-card-state', ch.done ? '✓' : ch.unlocked ? `${doneCount}/${ch.nodes.length}` : '🔒'));
    card.addEventListener('click', () => {
      if (!ch.unlocked) return banner('Termina el capítulo anterior para desbloquearlo', true);
      openChapter(ch.id);
    });
    return card;
  }

  function renderMap() {
    $('map-nohero').hidden = data.hasHero;
    $('map-list').replaceChildren(...data.chapters.filter((c) => !c.extra).map(chapterCard));
    const extras = data.chapters.filter((c) => c.extra);
    $('map-extra').replaceChildren(...extras.map(chapterCard));
    $('map-extra-title').hidden = !data.hasHero || extras.length === 0;
    show('s-map');
  }

  // ---------- capítulo ----------
  const ICONS = { story: '📜', battle: '⚔️', boss: '💀' };

  function openChapter(id) {
    chapter = data.chapters.find((c) => c.id === id);
    $('ch-head').style.backgroundImage = `linear-gradient(180deg, rgba(27,16,53,0.2), rgba(27,16,53,0.95)), url("${chapter.img}")`;
    $('ch-title').textContent = chapter.title;
    $('ch-place').textContent = chapter.place;
    const path = $('ch-path');
    path.replaceChildren();
    const nextId = (chapter.nodes.find((n) => n.unlocked && !n.done) || {}).id;
    for (const n of chapter.nodes) {
      const li = el('li', `lore-node ${n.type}${n.done ? ' done' : ''}${n.id === nextId ? ' next' : ''}${n.unlocked ? '' : ' locked'}`);
      const b = el('button', 'lore-node-btn');
      b.type = 'button';
      b.appendChild(el('span', 'lore-node-icon', n.unlocked ? ICONS[n.type] : '🔒'));
      const t = el('span', 'lore-node-txt');
      t.append(el('strong', '', n.title));
      if (n.type !== 'story') t.append(el('small', '', `${n.type === 'boss' ? 'Jefe · ' : ''}${n.hp} aciertos para ganar${n.reward && !n.done ? ` · +${n.reward.xp} XP` : ''}`));
      else t.append(el('small', '', n.done ? 'Leída' : 'Escena'));
      b.appendChild(t);
      if (n.done) b.appendChild(el('span', 'lore-node-ok', '✓'));
      b.addEventListener('click', () => {
        if (!n.unlocked) return banner('Antes tienes que superar lo anterior', true);
        openNode(n);
      });
      li.appendChild(b);
      path.appendChild(li);
    }
    const r = chapter.reward;
    $('ch-reward').textContent = r && r.items.length ? `🎁 Recompensa del jefe: ${r.items.map((i) => i.name).join(' + ')}` : '';
    show('s-chapter');
    const next = path.querySelector('.next');
    if (next) setTimeout(() => next.scrollIntoView({ behavior: 'smooth', block: 'center' }), 350);
  }

  function nextNodeAfter(node) {
    const i = chapter.nodes.findIndex((n) => n.id === node.id);
    return chapter.nodes[i + 1] || null;
  }

  function openNode(n) {
    if (n.type === 'story') return playStory(n);
    return battleIntro(n);
  }

  async function afterNode(node) {
    await load();
    const next = chapter && nextNodeAfter(node);
    const fresh = next && chapter.nodes.find((x) => x.id === next.id);
    if (fresh && fresh.unlocked && !fresh.done) return openNode(fresh);
    if (chapter && chapter.done && !node.done) {
      banner('🏆 ¡Capítulo completado!');
      FX.confetti && FX.confetti(160);
      return renderMap();
    }
    if (chapter) openChapter(chapter.id);
  }

  // ---------- escenas ----------
  function speakerFor(who) {
    if (who === 'heroe') return { name: me().name || 'Tú', hero: me().hero };
    if (who === 'jefe') {
      const boss = chapter.nodes.find((n) => n.type === 'boss');
      return { name: boss.enemy.name, img: boss.enemy.img };
    }
    return data.speakers[who] || { name: '' };
  }

  function playStory(node) {
    $('st-bg').style.backgroundImage = `url("${chapter.img}")`;
    let i = 0;
    const paint = () => {
      const [who, text] = node.lines[i];
      const sp = speakerFor(who);
      const box = $('st-speaker');
      box.replaceChildren();
      box.className = `lore-speaker${who === 'narrador' ? ' narrator' : ''}${who === 'jefe' ? ' villain' : ''}`;
      if (who !== 'narrador') {
        if (sp.hero) box.appendChild(Hero.portrait(sp.hero, { size: 'sm' }));
        else if (sp.img) {
          const img = el('img', 'lore-speaker-img');
          img.src = sp.img;
          img.alt = '';
          box.appendChild(img);
        } else if (sp.icon) box.appendChild(el('span', 'lore-speaker-icon', sp.icon));
        box.appendChild(el('strong', '', sp.name));
      }
      $('st-text').textContent = fill(text);
      $('st-next').textContent = i === node.lines.length - 1 ? 'Seguir ▸▸' : 'Continuar ▸';
      FX.enter($('st-dialog'));
    };
    const finish = async () => {
      try {
        await api.post(`/api/campaign/nodes/${node.id}/read`, {});
      } catch (err) {
        banner(err.message, true);
      }
      afterNode(node);
    };
    $('st-next').onclick = () => {
      FX.play('click');
      if (i < node.lines.length - 1) {
        i += 1;
        paint();
      } else finish();
    };
    $('st-skip').onclick = finish;
    show('s-story');
    paint();
  }

  // ---------- combates ----------
  const battle = { run: null, node: null, timer: null, deadline: 0, busy: false };

  function hpBar(hp, max) {
    const box = $('bt-hp');
    box.replaceChildren();
    for (let k = 0; k < max; k++) box.appendChild(el('span', k < hp ? 'on' : ''));
  }
  function hearts(n) {
    const box = $('bt-hearts');
    box.replaceChildren();
    for (let k = 0; k < data.hearts; k++) box.appendChild(el('span', k < n ? 'on' : '', k < n ? '❤️' : '🖤'));
  }

  function battleIntro(node) {
    battle.node = node;
    $('bt-bg').style.backgroundImage = `url("${chapter.img}")`;
    $('bt-enemy-img').src = node.enemy.img;
    $('bt-enemy-name').textContent = node.enemy.name;
    hpBar(node.hp, node.hp);
    $('bt-me').replaceChildren(Hero.portrait(me().hero, { level: me().level, size: 'sm' }));
    hearts(data.hearts);
    const body = $('bt-body');
    body.replaceChildren();
    const card = el('div', 'card lore-intro');
    card.append(
      el('h2', '', node.type === 'boss' ? `💀 ${node.enemy.name}` : `⚔️ ${node.title}`),
      el('p', '', `Acierta ${node.hp} preguntas antes de perder tus ${data.hearts} corazones. Tienes 15 segundos por pregunta.`)
    );
    if (node.reward && !node.done) {
      const parts = [`+${node.reward.xp} XP`, `+${node.reward.coins} 🪙`, ...node.reward.items.map((it) => `🎁 ${it.name}`)];
      card.appendChild(el('p', 'lore-intro-reward', parts.join(' · ')));
    }
    const go = el('button', 'btn', '¡A luchar!');
    go.type = 'button';
    go.addEventListener('click', () => startBattle(node, go));
    const back = el('button', 'btn btn-secondary', 'Volver');
    back.type = 'button';
    back.addEventListener('click', () => openChapter(chapter.id));
    card.append(go, back);
    body.appendChild(card);
    show('s-battle');
    if (node.type === 'boss') FX.play('boom');
  }

  async function startBattle(node, button) {
    button.disabled = true;
    try {
      const r = await api.post(`/api/campaign/nodes/${node.id}/start`, {});
      battle.run = r;
      hpBar(r.enemyHp, r.enemyMax);
      hearts(r.hearts);
      FX.play('go');
      askQuestion(r.question);
    } catch (err) {
      banner(err.message, true);
      button.disabled = false;
    }
  }

  function askQuestion(q) {
    battle.busy = false;
    const body = $('bt-body');
    const card = el('div', 'card lore-q');
    const timer = el('div', 'timer');
    const bar = el('div', 'timer-bar');
    timer.appendChild(bar);
    card.append(timer, el('div', 'question-cat', categoryLabel(q.category)), el('h2', 'question-text', q.text));
    const opts = el('div', 'options');
    q.options.forEach((text, i) => {
      const b = el('button', 'option', text);
      b.type = 'button';
      b.addEventListener('click', () => answer(q, i, b, opts));
      opts.appendChild(b);
    });
    card.appendChild(opts);
    body.replaceChildren(card);
    FX.enter(card);
    battle.deadline = performance.now() + q.ms;
    cancelAnimationFrame(battle.timer);
    const tick = () => {
      const left = Math.max(0, battle.deadline - performance.now());
      bar.style.transform = `scaleX(${left / q.ms})`;
      bar.classList.toggle('low', left < 4000);
      if (left <= 0 && !battle.busy) return answer(q, -1, null, opts);
      if (!battle.busy) battle.timer = requestAnimationFrame(tick);
    };
    battle.timer = requestAnimationFrame(tick);
  }

  async function answer(q, option, button, opts) {
    if (battle.busy) return;
    battle.busy = true;
    cancelAnimationFrame(battle.timer);
    for (const b of opts.children) b.disabled = true;
    if (button) button.classList.add('picked');
    let res;
    try {
      res = await api.post(`/api/campaign/runs/${battle.run.runId}/answer`, { index: q.index, option });
    } catch (err) {
      banner(err.message, true);
      return openChapter(chapter.id);
    }
    const buttons = [...opts.children];
    if (buttons[res.correctIndex]) buttons[res.correctIndex].classList.add('correct');
    if (!res.right && button) button.classList.add('wrong');
    hpBar(res.enemyHp, battle.run.enemyMax);
    hearts(res.hearts);
    if (res.right) {
      FX.play('correct');
      FX.shake && FX.shake($('bt-enemy'));
      FX.burst && FX.burst($('bt-enemy-img'), { colors: ['#ffe58a', '#fff', '#ff8a3d'], amount: 18 });
    } else {
      FX.play('wrong');
      FX.flash && FX.flash('bad');
      FX.shake && FX.shake($('bt-me'));
      if (res.late) banner('⏰ ¡Se acabó el tiempo!', true);
    }
    setTimeout(() => {
      if (res.status === 'active') return askQuestion(res.question);
      return battleEnd(res);
    }, 1400);
  }

  function battleEnd(res) {
    const node = battle.node;
    const body = $('bt-body');
    const card = el('div', 'card lore-intro');
    if (res.status === 'won') {
      FX.play('victory');
      FX.confetti && FX.confetti(140);
      card.appendChild(el('h2', '', node.type === 'boss' ? `🏆 ¡Has vencido a ${node.enemy.name}!` : '🏆 ¡Victoria!'));
      if (res.first && res.reward) {
        const parts = [`+${res.reward.coins} 🪙`, ...res.reward.items.map((it) => `🎁 ${it.name}`)];
        card.appendChild(el('p', 'lore-intro-reward', parts.join(' · ')));
        if (res.reward.items.length) card.appendChild(el('p', 'muted', 'Equípalo en tu héroe para que lo vean tus rivales.'));
        if (res.balance !== null && res.balance !== undefined) Wallet.setCoins(res.balance);
        if (res.xp) card.appendChild(Hero.xpResult(res.xp));
      } else {
        card.appendChild(el('p', 'muted', 'Ya habías ganado este combate: esta vez no hay premio, pero has practicado.'));
      }
      const go = el('button', 'btn', 'Continuar la historia ▸');
      go.type = 'button';
      go.addEventListener('click', () => afterNode(node));
      card.appendChild(go);
      if (res.reward && res.reward.items.length) {
        const hero = el('a', 'btn btn-secondary', '⚔️ Equipar en mi héroe');
        hero.href = '/heroe';
        card.appendChild(hero);
      }
    } else {
      FX.play('defeat');
      card.appendChild(el('h2', '', '💫 Has caído…'));
      card.appendChild(el('p', '', 'El Olvido te ha ganado esta vez. Cada intento trae preguntas nuevas: ¡vuelve a intentarlo!'));
      const again = el('button', 'btn', 'Reintentar');
      again.type = 'button';
      again.addEventListener('click', () => battleIntro(node));
      const back = el('button', 'btn btn-secondary', 'Volver al capítulo');
      back.type = 'button';
      back.addEventListener('click', () => openChapter(chapter.id));
      card.append(again, back);
    }
    body.replaceChildren(card);
    FX.enter(card);
  }

  $('ch-back').addEventListener('click', async () => {
    await load();
    renderMap();
  });

  try {
    await load();
  } catch (err) {
    if (err.status === 401) return Player.ensure('Tu sesión ha caducado. Vuelve a entrar con Google.');
    return banner(err.message, true);
  }
  // Primera vez: directo a la primera escena de tu prólogo.
  const first = data.chapters[0];
  if (data.hasHero && first && first.nodes.every((n) => !n.done)) {
    chapter = first;
    return playStory(first.nodes[0]);
  }
  renderMap();
})();
