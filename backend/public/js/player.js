// Perfil de invitado: un nombre y un token guardado en este navegador.
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
  has() {
    return !!(this.token && this.data);
  },
  save(player, token) {
    if (token) storage.set('ysl:token', token);
    storage.set('ysl:player', JSON.stringify(player));
    storage.set('ysl:name', player.name);
    renderMeChip();
  },
  clear() {
    storage.remove('ysl:token');
    storage.remove('ysl:player');
    renderMeChip();
  },
  async create(name) {
    const { player, token } = await api.post('/api/players', { name });
    this.save(player, token);
    return player;
  },
  async refresh() {
    try {
      const me = await api.get('/api/players/me');
      this.save(me);
      return me;
    } catch (err) {
      if (err.status === 401) this.clear();
      throw err;
    }
  },
  async rename(name) {
    const player = await api.patch('/api/players/me', { name });
    this.save(player);
    return player;
  },

  // Garantiza que hay perfil: si no lo hay, pide el nombre en una ventana.
  ensure(message = 'Elige el nombre con el que te verán los demás jugadores.') {
    if (this.has()) return Promise.resolve(this.data);
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      overlay.innerHTML = `
        <form class="card" novalidate>
          <h2>¿Cómo te llamas?</h2>
          <p></p>
          <label for="ensure-name">Tu nombre</label>
          <input type="text" id="ensure-name" maxlength="20" autocomplete="nickname" placeholder="Tu nombre">
          <button class="btn" type="submit">Continuar</button>
          <p class="form-error" hidden></p>
        </form>`;
      overlay.querySelector('p').textContent = message;
      const form = overlay.querySelector('form');
      const input = overlay.querySelector('input');
      const error = overlay.querySelector('.form-error');
      input.value = storage.get('ysl:name') || '';
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        error.hidden = true;
        const button = form.querySelector('button');
        button.disabled = true;
        try {
          const player = await Player.create(input.value);
          overlay.remove();
          resolve(player);
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
          button.disabled = false;
        }
      });
      document.body.appendChild(overlay);
      input.focus();
    });
  },
};

// Botón con el nombre del jugador en la cabecera (enlace al perfil).
function renderMeChip() {
  const el = document.getElementById('me-chip');
  if (!el) return;
  const data = Player.data;
  el.textContent = data && Player.token ? `👤 ${data.name}` : '👤 Mi perfil';
}

document.addEventListener('DOMContentLoaded', renderMeChip);
