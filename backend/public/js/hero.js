// Tarjeta del héroe: retrato + marco (armadura) + aura (arma) + emblema + estandarte (fondo) + título.
// Se usa en el perfil del héroe, en la creación y delante de los rivales en las partidas.
(function () {
  const EMBLEM_ICONS = { bronce: '🛡️', buho: '🦉', corona: '👑', dragon_e: '🐉', estrella: '🌟', reloj: '⏳' };
  const RACE_NAMES = { humano: 'Humano', elfo: 'Elfo', enano: 'Enano', orco: 'Orco' };
  const CLASS_NAMES = { guerrero: 'Guerrero', mago: 'Mago', explorador: 'Explorador' };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  const portraitSrc = (h) => `/img/heroes/${h.race}-${h.cls}-${h.sex === 'm' ? 'm' : 'h'}.webp`;

  // Solo el retrato con sus efectos (marco, aura, fondo, emblema y nivel).
  function portrait(h, { level = null, size = 'md' } = {}) {
    const equip = (h && h.equip) || {};
    const box = el('div', `hero-portrait size-${size} armor-${equip.armadura || 'cuero'} aura-${equip.arma || 'ninguna'} banner-${equip.estandarte || 'noche'}`);
    box.appendChild(el('div', 'hero-aura'));
    const frame = el('div', 'hero-frame');
    const img = el('img', 'hero-img');
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    if (h) img.src = portraitSrc(h);
    else img.src = '/img/heroes/vacio.webp';
    frame.appendChild(img);
    box.appendChild(frame);
    const icon = EMBLEM_ICONS[equip.emblema];
    if (icon) box.appendChild(el('span', 'hero-emblem', icon));
    if (level) box.appendChild(el('span', 'hero-level', String(level)));
    return box;
  }

  // Tarjeta completa: retrato + nombre + título + raza/clase + poder.
  function card(p, { size = 'md', you = false } = {}) {
    const c = el('div', `hero-card size-${size}${you ? ' you' : ''}`);
    c.appendChild(portrait(p.hero, { level: p.level || 1, size }));
    const info = el('div', 'hero-info');
    info.appendChild(el('strong', 'hero-name', p.name || ''));
    if (p.hero) {
      info.appendChild(el('span', 'hero-title', p.hero.title || ''));
      info.appendChild(el('span', 'hero-kind', `${RACE_NAMES[p.hero.race] || ''} · ${CLASS_NAMES[p.hero.cls] || ''}`));
    } else {
      info.appendChild(el('span', 'hero-title', 'Sin héroe'));
    }
    info.appendChild(el('span', 'hero-power', `⚔️ ${(p.power || 0).toLocaleString('es-ES')}`));
    c.appendChild(info);
    return c;
  }

  // Pantalla «cara a cara» antes de una partida (duelo, sala o Conquista).
  function versus(players, meId) {
    const wrap = el('div', 'hero-versus');
    players.forEach((p, i) => {
      if (i > 0) wrap.appendChild(el('span', 'hero-vs', 'VS'));
      wrap.appendChild(card(p, { size: players.length > 2 ? 'sm' : 'md', you: p.id === meId }));
    });
    return wrap;
  }

  // Aviso de experiencia al terminar una partida (y fiesta si sube de nivel).
  function xpResult(xp) {
    if (!xp) return null;
    const box = el('div', `hero-xp${xp.levelUp ? ' up' : ''}`);
    box.appendChild(el('strong', 'hero-xp-gain', `+${xp.gained} XP`));
    const bar = el('div', 'hero-xp-bar');
    const fill = el('span');
    fill.style.transform = `scaleX(${xp.xpNext ? Math.min(1, xp.xpInto / xp.xpNext) : 1})`;
    bar.appendChild(fill);
    box.appendChild(bar);
    box.appendChild(el('span', 'hero-xp-level', xp.xpNext ? `Nivel ${xp.level} · ${xp.xpInto}/${xp.xpNext}` : `Nivel ${xp.level} (máximo)`));
    if (xp.levelUp) {
      box.appendChild(el('p', 'hero-xp-title', `🎉 ¡Has subido al nivel ${xp.level}!`));
      for (const r of xp.rewards || []) box.appendChild(el('p', 'hero-xp-reward', `🎁 Nuevo: ${r.name}`));
      for (const u of xp.unlocks || []) box.appendChild(el('p', 'hero-xp-reward', `🔓 ${u}`));
      const a = el('a', 'btn btn-secondary hero-xp-go', 'Ver mi héroe');
      a.href = '/heroe';
      box.appendChild(a);
      setTimeout(() => {
        if (window.FX) {
          FX.confetti && FX.confetti();
          FX.play && FX.play('victory');
        }
      }, 300);
    }
    return box;
  }

  // Cara pequeña (como los avatares): la del héroe si tiene, si no el animal de siempre.
  function face(p, cls = '') {
    if (!p || !p.hero) return FX.avatar(p ? p.name : '', p ? p.avatar : null, cls);
    const img = el('img', `avatar hero-face ${cls}`.trim());
    img.src = portraitSrc(p.hero);
    img.alt = '';
    img.width = 40;
    img.height = 40;
    img.decoding = 'async';
    return img;
  }

  window.Hero = { portrait, card, versus, xpResult, face, portraitSrc, RACE_NAMES, CLASS_NAMES };
})();
