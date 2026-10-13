(function () {
  const $ = (id) => document.getElementById(id);
  let catalog = null;
  let busy = false;

  let bannerTimer;
  function banner(text, warn = false) {
    const el = $('banner');
    clearTimeout(bannerTimer);
    el.textContent = text;
    el.className = warn ? 'banner warn' : 'banner';
    el.hidden = false;
    bannerTimer = setTimeout(() => (el.hidden = true), 3000);
  }

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  function renderCoins(animate) {
    const coins = Wallet.data.coins;
    if (animate) FX.countUp($('s-coins'), coins, 600);
    else $('s-coins').textContent = coins;
    Wallet.setCoins(coins);
  }

  function earnText(c) {
    return `Ganas monedas jugando: ${c.blitzPerCorrect} por acierto en el Blitz (+${c.blitzPersonalBest} si mejoras tu récord), ` +
      `${c.duel.win} por ganar un duelo, ${c.conquista[0]} por ganar una Conquista y ${c.dailyBonus} extra en tu primera partida del día.`;
  }

  async function buy(item, button) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    try {
      Wallet.data = await api.post('/api/shop/buy', { item });
      FX.play('correct');
      FX.burst(button, { amount: 24 });
      renderCoins(true);
      render();
    } catch (err) {
      FX.play('wrong');
      FX.shake(button.closest('.shop-item, .avatar-item'));
      banner(err.message, true);
      button.disabled = false;
    } finally {
      busy = false;
    }
  }

  async function wear(key, tile) {
    if (busy) return;
    busy = true;
    try {
      Wallet.data = await api.post('/api/shop/avatar', { avatar: key });
      const d = Player.data;
      if (d) Player.save({ ...d, avatar: key });
      FX.play('turn');
      FX.bump(tile);
      render();
    } catch (err) {
      banner(err.message, true);
    } finally {
      busy = false;
    }
  }

  function render() {
    const w = Wallet.data;
    const helpers = $('s-helpers');
    helpers.replaceChildren();
    for (const h of catalog.helpers) {
      const item = el('div', 'shop-item');
      const icon = el('div', 'shop-icon', h.icon);
      const info = el('div', 'shop-info');
      info.append(el('strong', '', h.name), el('span', '', h.description));
      const own = el('div', 'shop-own', `Tienes ${w.helpers[h.id] || 0}`);
      const btn = el('button', 'btn btn-buy', `🪙 ${h.price}`);
      btn.type = 'button';
      btn.disabled = w.coins < h.price;
      btn.setAttribute('aria-label', `Comprar ${h.name} por ${h.price} monedas`);
      btn.addEventListener('click', () => buy(h.id, btn));
      item.append(icon, info, own, btn);
      helpers.appendChild(item);
    }

    const avatars = $('s-avatars');
    avatars.replaceChildren();
    for (const a of catalog.avatars) {
      const owned = w.avatars.includes(a.id);
      const tile = el('div', 'avatar-item');
      if (w.avatar === a.id) tile.classList.add('worn');
      if (!owned) tile.classList.add('locked');
      const img = el('img', 'avatar');
      img.src = `/img/avatar-${a.id}.webp`;
      img.alt = '';
      img.width = 96;
      img.height = 96;
      tile.append(img, el('span', 'avatar-name', a.name));
      if (w.avatar === a.id) {
        tile.appendChild(el('span', 'avatar-tag', '✓ Puesto'));
      } else if (owned) {
        const b = el('button', 'btn btn-secondary btn-small', 'Ponérmelo');
        b.type = 'button';
        b.addEventListener('click', () => wear(a.id, tile));
        tile.appendChild(b);
      } else {
        const b = el('button', 'btn btn-buy btn-small', `🪙 ${a.price}`);
        b.type = 'button';
        b.disabled = w.coins < a.price;
        b.setAttribute('aria-label', `Comprar ${a.name} por ${a.price} monedas`);
        b.addEventListener('click', () => buy(`avatar:${a.id}`, b));
        tile.appendChild(b);
      }
      avatars.appendChild(tile);
    }
  }

  (async function init() {
    await Player.ensure('Entra con Google o con tu correo para ver tus monedas y la tienda.');
    try {
      [catalog] = await Promise.all([api.get('/api/shop/catalog'), Wallet.load()]);
      if (!Wallet.data) return Player.ensure();
      $('s-earn').textContent = earnText(catalog.coins);
      renderCoins(true);
      render();
    } catch (err) {
      $('s-error').textContent = err.message;
      $('s-error').hidden = false;
    }
  })();
})();
