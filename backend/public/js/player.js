// Cuenta del jugador: se entra con Google. El token de sesión se guarda en este navegador.
const Player = {
  get token() {
    return storage.get('ysl:token');
  },
  get data() {
    try {
      return JSON.parse(storage.get('ysl:player') || 'null');
    } catch {
      return null;
    }
  },
  // Solo vale una cuenta de Google (los perfiles de invitado antiguos ya no sirven para jugar).
  has() {
    const d = this.data;
    return !!(this.token && d && d.hasAccount);
  },
  save(player, token) {
    if (token) storage.set('ysl:token', token);
    storage.set('ysl:player', JSON.stringify(player));
    storage.set('ysl:name', player.name);
    renderMeChip();
  },
  // Cerrar sesión en este navegador.
  clear() {
    storage.remove('ysl:token');
    storage.remove('ysl:player');
    renderMeChip();
  },
  // La sesión ya no vale: se olvidan los datos, pero el token se queda por si era un
  // perfil de invitado antiguo (al entrar con Google se convierte en la cuenta).
  forget() {
    storage.remove('ysl:player');
    renderMeChip();
  },
  async refresh() {
    try {
      const me = await api.get('/api/players/me');
      this.save(me);
      return me;
    } catch (err) {
      if (err.status === 401) this.forget();
      throw err;
    }
  },
  async rename(name) {
    const player = await api.patch('/api/players/me', { name });
    this.save(player);
    return player;
  },
  async logout() {
    try {
      await api.post('/api/auth/logout', {});
    } catch {
      // aunque falle, se cierra en este navegador
    }
    this.clear();
    Wallet.data = null;
  },
  loginUrl(next = location.pathname + location.search) {
    return `/auth/google?next=${encodeURIComponent(next)}`;
  },

  // Garantiza que hay cuenta: si no, muestra la ventana para entrar con Google.
  // next: a dónde volver después de entrar (por defecto, esta misma página).
  ensure(message, next) {
    if (this.has()) return Promise.resolve(this.data);
    showLogin(message || 'Para jugar necesitas entrar con tu cuenta de Google. Así guardamos tus monedas, avatares y estadísticas en todos tus dispositivos.', next);
    // No se resuelve: al entrar con Google se vuelve a esta misma página.
    return new Promise(() => {});
  },
};

function showLogin(message, next) {
  if (document.querySelector('.overlay.login')) return;
  const overlay = document.createElement('div');
  overlay.className = 'overlay login';
  overlay.innerHTML = `
    <div class="card login-card" role="dialog" aria-modal="true" aria-labelledby="login-title">
      <img class="login-art" src="/img/logo.webp" alt="" width="900" height="580">
      <h2 id="login-title">¡Entra para jugar!</h2>
      <p class="login-msg"></p>
      <ul class="login-perks">
        <li>🪙 <strong>100 monedas</strong> de bienvenida</li>
        <li>🎁 Un comodín de cada tipo</li>
        <li>📱 Tu progreso en el móvil y en el ordenador</li>
      </ul>
      <a class="btn btn-google" href="#"><span class="g-logo" aria-hidden="true">G</span> Entrar con Google</a>
      <a class="link-btn login-back" href="/">Volver al inicio</a>
    </div>`;
  overlay.querySelector('.login-msg').textContent = message;
  overlay.querySelector('.btn-google').href = Player.loginUrl(next);
  document.body.appendChild(overlay);
  overlay.querySelector('.btn-google').focus();
}

// Monedas y comodines del jugador.
const Wallet = {
  data: null,
  async load() {
    if (!Player.has()) return null;
    try {
      this.data = await api.get('/api/shop/me');
      renderMeChip();
    } catch (err) {
      if (err.status === 401) Player.forget();
    }
    return this.data;
  },
  count(kind) {
    return this.data && this.data.helpers ? this.data.helpers[kind] || 0 : 0;
  },
  setCount(kind, n) {
    if (this.data && this.data.helpers) this.data.helpers[kind] = n;
  },
  setCoins(n) {
    if (n === null || n === undefined) return;
    if (this.data) this.data.coins = n;
    const d = Player.data;
    if (d) {
      d.coins = n;
      storage.set('ysl:player', JSON.stringify(d));
    }
    renderMeChip();
  },
};

// Cabecera: avatar + nombre (perfil) y monedas (tienda).
function renderMeChip() {
  const el = document.getElementById('me-chip');
  if (!el) return;
  const data = Player.data;
  el.replaceChildren();
  if (data && Player.token && data.hasAccount) {
    if (data.hero) {
      // Con héroe: su cara en la cabecera.
      const img = document.createElement('img');
      img.className = 'avatar chip-avatar';
      img.alt = '';
      img.width = 40;
      img.height = 40;
      img.src = `/img/heroes/${data.hero.race}-${data.hero.cls}-${data.hero.sex === 'm' ? 'm' : 'h'}.webp`;
      el.appendChild(img);
    } else if (window.FX) el.appendChild(FX.avatar(data.name, data.avatar, 'chip-avatar'));
    const n = document.createElement('span');
    n.className = 'chip-name';
    n.textContent = data.name;
    el.appendChild(n);
    el.href = '/perfil';
  } else {
    el.textContent = '🔑 Entrar';
    el.href = Player.loginUrl();
  }
  let coins = document.getElementById('coin-chip');
  if (!coins && el.parentElement) {
    coins = document.createElement('a');
    coins.id = 'coin-chip';
    coins.className = 'coin-chip';
    coins.href = '/tienda';
    coins.setAttribute('aria-label', 'Monedas · ir a la tienda');
    el.before(coins);
  }
  if (coins) {
    const has = data && data.hasAccount && Player.token;
    coins.hidden = !has;
    const value = Wallet.data ? Wallet.data.coins : data ? data.coins : 0;
    coins.replaceChildren();
    const img = document.createElement('img');
    img.src = '/img/ic-moneda.webp';
    img.alt = '';
    const n = document.createElement('span');
    n.textContent = value ?? 0;
    coins.append(img, n);
  }
}

// La fecha de nacimiento es obligatoria: sin ella, se pide antes de seguir.
const BIRTHDATE_FREE_PAGES = ['/edad', '/entrar', '/privacidad'];
function needsBirthdate(data) {
  return data && data.hasAccount && data.birthdateSet === false && !BIRTHDATE_FREE_PAGES.includes(location.pathname);
}
function askBirthdate() {
  location.replace(`/edad?next=${encodeURIComponent(location.pathname + location.search)}`);
}

// ¡Feliz cumpleaños! (el servidor da el regalo una vez al año)
function celebrateBirthday(me) {
  if (!me || !me.birthdayGift) return;
  const box = document.createElement('div');
  box.className = 'birthday-pop';
  const t = document.createElement('strong');
  t.textContent = '🎂 ¡Feliz cumpleaños!';
  const p = document.createElement('span');
  p.textContent = `Te regalamos ${me.birthdayGift} monedas 🪙`;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.textContent = '¡Gracias!';
  b.addEventListener('click', () => box.remove());
  box.append(t, p, b);
  document.body.appendChild(box);
  if (window.FX) {
    FX.confetti && FX.confetti(220);
    FX.play && FX.play('victory');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderMeChip();
  if (needsBirthdate(Player.data)) return askBirthdate();
  // Actualiza monedas y datos en segundo plano.
  if (Player.has()) {
    Player.refresh()
      .then((me) => {
        if (needsBirthdate(me)) return askBirthdate();
        if (me.birthdayGift) Wallet.setCoins(me.coins);
        celebrateBirthday(me);
      })
      .catch(() => {});
  }
});
