// Chat: botón 💬 en la cabecera de todas las páginas, con tres pestañas:
//  · Partida  – en directo por el WebSocket del juego (solo cuando estás en una sala o partida)
//  · General  – sala abierta para todos
//  · Privados – conversaciones uno a uno
// General y privados se consultan a la API cada pocos segundos mientras el panel está abierto.
(function () {
  if (typeof Player === 'undefined' || typeof api === 'undefined') return;
  // En los portales de juegos no hay chat (no se puede moderar ahí).
  if (window.YSL && YSL.portal) return;

  const MAX = 200;
  const POLL_OPEN_MS = 3000;
  const POLL_CLOSED_MS = 30000;
  const QUICK = ['¡Suerte! 🍀', '¡Bien jugado! 👏', '¡Uf, casi! 😅', '¡Vamos! 🔥', '¡Revancha! ⚔️', 'GG 🤝'];
  const REASONS = [
    ['insultos', 'Insultos u ofensas'],
    ['acoso', 'Acoso o amenazas'],
    ['inapropiado', 'Contenido inapropiado'],
    ['spam', 'Spam o publicidad'],
    ['otro', 'Otro motivo'],
  ];

  const state = {
    open: false,
    tab: 'general',
    lobby: [],
    convs: [],
    unreadDm: 0,
    thread: null, // { with, messages, canWrite, reason, blocked }
    match: null, // { send, messages, unread }
    settings: null,
    searching: '',
    results: [],
    lastPoll: 0,
    lastClosedPoll: 0,
  };

  const me = () => (Player.data && Player.data.id) || null;

  // ---------- utilidades DOM ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function button(cls, text, onClick) {
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  const time = (iso) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  function merge(list, incoming) {
    const seen = new Set(list.map((m) => m.id));
    for (const m of incoming) if (!seen.has(m.id)) list.push(m);
    list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    if (list.length > 150) list.splice(0, list.length - 150);
    return list;
  }

  // ---------- estructura ----------
  const btn = el('button', 'chat-btn');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Abrir el chat');
  btn.append(el('span', 'chat-ico', '💬'));
  const badge = el('span', 'chat-badge');
  badge.hidden = true;
  btn.appendChild(badge);
  btn.hidden = true;

  const toast = el('button', 'chat-toast');
  toast.type = 'button';
  toast.hidden = true;

  const backdrop = el('div', 'chat-backdrop');
  backdrop.hidden = true;
  const panel = el('section', 'chat-panel');
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chat');

  const head = el('div', 'chat-head');
  const tabs = el('div', 'chat-tabs');
  const tabBtns = {};
  for (const [key, label] of [['match', 'Partida'], ['general', 'General'], ['dm', 'Privados']]) {
    const b = button('chat-tab', label, () => switchTab(key));
    b.dataset.tab = key;
    const dot = el('span', 'chat-dot');
    dot.hidden = true;
    b.appendChild(dot);
    tabBtns[key] = b;
    tabs.appendChild(b);
  }
  const closeBtn = button('chat-close', '✕', () => toggle(false));
  closeBtn.setAttribute('aria-label', 'Cerrar el chat');
  head.append(tabs, closeBtn);

  const body = el('div', 'chat-body');
  const menu = el('div', 'chat-menu');
  menu.hidden = true;

  const composer = el('form', 'chat-composer');
  const input = el('input', 'chat-input');
  input.type = 'text';
  input.maxLength = MAX;
  input.autocomplete = 'off';
  input.enterKeyHint = 'send';
  input.placeholder = 'Escribe un mensaje…';
  const counter = el('span', 'chat-counter');
  const sendBtn = el('button', 'chat-send', '➤');
  sendBtn.type = 'submit';
  sendBtn.setAttribute('aria-label', 'Enviar');
  composer.append(input, counter, sendBtn);
  const quick = el('div', 'chat-quick');
  for (const q of QUICK) quick.appendChild(button('chat-chip', q, () => send(q)));
  const note = el('p', 'chat-note');

  panel.append(head, body, quick, note, composer, menu);

  function mount() {
    const actions = document.querySelector('.site-header .header-actions') || document.querySelector('.site-header');
    if (!actions) return false;
    actions.prepend(btn);
    document.body.append(toast, backdrop, panel);
    return true;
  }

  // ---------- abrir / cerrar ----------
  function toggle(open) {
    state.open = open;
    panel.hidden = !open;
    backdrop.hidden = !open;
    document.documentElement.classList.toggle('chat-open', open);
    if (open) {
      toast.hidden = true;
      if (state.match && !state.thread) state.tab = state.tab === 'general' && state.match.unread ? 'match' : state.tab;
      render();
      poll(true);
    } else {
      closeMenu();
    }
  }

  function switchTab(tab) {
    if (tab === 'match' && !state.match) return;
    state.tab = tab;
    if (tab !== 'dm') state.thread = null;
    closeMenu();
    render();
    poll(true);
  }

  btn.addEventListener('click', () => toggle(!state.open));
  backdrop.addEventListener('click', () => toggle(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.open) toggle(false);
  });
  toast.addEventListener('click', () => {
    toast.hidden = true;
    if (toast.dataset.go === 'dm' && toast.dataset.with) openThread(toast.dataset.with);
    else if (toast.dataset.go) switchTab(toast.dataset.go);
    toggle(true);
  });

  let toastTimer = null;
  function showToast(text, go, withId) {
    if (state.open) return;
    toast.textContent = text;
    toast.dataset.go = go;
    toast.dataset.with = withId || '';
    toast.hidden = false;
    FX.enter(toast);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 4000);
  }

  // ---------- contadores ----------
  function paintBadges() {
    const matchUnread = state.match ? state.match.unread : 0;
    const total = state.unreadDm + matchUnread;
    badge.hidden = total === 0;
    badge.textContent = total > 9 ? '9+' : String(total);
    tabBtns.match.hidden = !state.match;
    tabBtns.match.querySelector('.chat-dot').hidden = !matchUnread;
    tabBtns.dm.querySelector('.chat-dot').hidden = !state.unreadDm;
    for (const [k, b] of Object.entries(tabBtns)) b.classList.toggle('on', k === state.tab);
  }

  // ---------- pintar ----------
  function messageRow(m, { canAct = true, dm = false } = {}) {
    const mine = m.from.id === me();
    const row = el('div', `chat-msg${mine ? ' mine' : ''}`);
    if (!mine) row.appendChild(FX.avatar(m.from.name, m.from.avatar, 'chat-av'));
    const bubble = el('div', 'chat-bubble');
    if (!mine && !dm) bubble.appendChild(el('span', 'chat-name', m.from.name));
    bubble.appendChild(el('span', 'chat-text', m.text));
    bubble.appendChild(el('span', 'chat-time', time(m.at)));
    row.appendChild(bubble);
    if (!mine && canAct) {
      bubble.tabIndex = 0;
      bubble.setAttribute('role', 'button');
      bubble.setAttribute('aria-label', `Opciones del mensaje de ${m.from.name}`);
      const open = () => openMenu(m, { dm });
      bubble.addEventListener('click', open);
      bubble.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') open();
      });
    }
    return row;
  }

  function list(messages, empty, opts) {
    const box = el('div', 'chat-list');
    if (!messages.length) box.appendChild(el('p', 'chat-empty', empty));
    for (const m of messages) box.appendChild(messageRow(m, opts));
    return box;
  }

  function scrollDown() {
    const l = body.querySelector('.chat-list');
    if (l) l.scrollTop = l.scrollHeight;
  }

  function setComposer(enabled, placeholder) {
    composer.hidden = false;
    input.disabled = !enabled;
    sendBtn.disabled = !enabled;
    input.placeholder = placeholder || 'Escribe un mensaje…';
  }

  function render() {
    paintBadges();
    body.replaceChildren();
    quick.hidden = true;
    note.hidden = true;
    composer.hidden = true;
    const muted = state.settings && state.settings.mutedUntil;

    if (state.tab === 'match' && state.match) {
      state.match.unread = 0;
      paintBadges();
      body.appendChild(list(state.match.messages, 'Saluda a tus rivales 👋'));
      quick.hidden = !!muted;
      setComposer(!muted, muted ? 'No puedes escribir ahora' : 'Mensaje para la partida…');
    } else if (state.tab === 'general') {
      body.appendChild(list(state.lobby, 'Aún no hay mensajes. ¡Rompe el hielo!'));
      note.textContent = 'Sé amable. No compartas datos personales. Toca un mensaje para reportarlo o bloquear.';
      note.hidden = false;
      const lvl = (Player.data && Player.data.level) || 1;
      if (lvl < 2) setComposer(false, '🔒 Podrás escribir aquí desde el nivel 2');
      else setComposer(!muted, muted ? 'No puedes escribir ahora' : 'Mensaje para todos…');
    } else if (state.tab === 'dm' && state.thread) {
      renderThread();
    } else {
      renderInbox();
    }
    if (muted) {
      note.textContent = `Tus mensajes han sido reportados varias veces. Podrás volver a escribir a las ${time(muted)}.`;
      note.hidden = false;
    }
    scrollDown();
  }

  function renderThread() {
    const t = state.thread;
    const bar = el('div', 'chat-thread-bar');
    bar.appendChild(button('chat-back', '←', () => {
      state.thread = null;
      render();
      poll(true);
    }));
    bar.appendChild(FX.avatar(t.with.name, t.with.avatar, 'chat-av'));
    bar.appendChild(el('strong', 'chat-thread-name', t.with.name));
    bar.appendChild(
      button('chat-more', t.blocked ? 'Desbloquear' : '🚫 Bloquear', () => (t.blocked ? unblock(t.with) : confirmBlock(t.with)))
    );
    body.appendChild(bar);
    body.appendChild(list(t.messages, `Escribe a ${t.with.name}. Sé amable 🙂`, { dm: true }));
    note.textContent = 'Toca un mensaje para reportarlo. Nunca compartas tu dirección, teléfono ni contraseñas.';
    note.hidden = false;
    if (t.canWrite) setComposer(true, `Mensaje para ${t.with.name}…`);
    else {
      composer.hidden = false;
      setComposer(false, t.reason || 'No puedes escribir aquí');
    }
  }

  function renderInbox() {
    const search = el('input', 'chat-search');
    search.type = 'search';
    search.placeholder = '🔎 Busca un jugador por su nombre';
    search.maxLength = 20;
    search.value = state.searching;
    let timer = null;
    search.addEventListener('input', () => {
      state.searching = search.value;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (search.value.trim().length < 2) {
          state.results = [];
        } else {
          try {
            state.results = (await api.get(`/api/chat/search?name=${encodeURIComponent(search.value.trim())}`)).players;
          } catch {
            state.results = [];
          }
        }
        paintResults();
      }, 300);
    });
    const results = el('div', 'chat-people');
    const paintResults = () => {
      results.replaceChildren();
      for (const p of state.results) {
        const b = button('chat-person', '', () => openThread(p.id));
        b.append(FX.avatar(p.name, p.avatar, 'chat-av'), el('span', '', p.name), el('span', 'go', 'Escribir →'));
        results.appendChild(b);
      }
      if (state.searching.trim().length >= 2 && !state.results.length) results.appendChild(el('p', 'chat-empty', 'Nadie con ese nombre'));
    };
    paintResults();
    body.append(search, results);

    const convs = el('div', 'chat-convs');
    if (!state.convs.length && !state.searching) {
      convs.appendChild(el('p', 'chat-empty', 'No tienes conversaciones. Busca a alguien o toca un mensaje de la sala General.'));
    }
    for (const c of state.convs) {
      const b = button(`chat-conv${c.unread ? ' unread' : ''}`, '', () => openThread(c.with.id));
      const txt = el('span', 'chat-conv-txt');
      txt.append(el('strong', '', c.with.name), el('span', 'chat-conv-last', `${c.last.from.id === me() ? 'Tú: ' : ''}${c.last.text}`));
      b.append(FX.avatar(c.with.name, c.with.avatar, 'chat-av'), txt);
      if (c.unread) b.appendChild(el('span', 'chat-badge static', String(c.unread)));
      convs.appendChild(b);
    }
    body.appendChild(convs);
    body.appendChild(settingsBox());
  }

  function settingsBox() {
    const box = el('details', 'chat-settings');
    box.appendChild(el('summary', '', '⚙️ Ajustes del chat'));
    const s = state.settings;
    if (!s) return box;
    const label = el('label', 'chat-toggle');
    const check = el('input');
    check.type = 'checkbox';
    check.checked = s.dmOpen;
    check.addEventListener('change', async () => {
      try {
        state.settings = await api.patch('/api/chat/settings', { dmOpen: check.checked });
      } catch (err) {
        check.checked = !check.checked;
        flash(err.message);
      }
    });
    label.append(check, el('span', '', 'Recibir mensajes privados de otros jugadores'));
    box.appendChild(label);
    box.appendChild(el('p', 'chat-sub', s.blocked.length ? 'Jugadores bloqueados:' : 'No has bloqueado a nadie.'));
    for (const p of s.blocked) {
      const row = el('div', 'chat-person');
      row.append(FX.avatar(p.name, p.avatar, 'chat-av'), el('span', '', p.name), button('chat-more', 'Desbloquear', () => unblock(p)));
      box.appendChild(row);
    }
    return box;
  }

  // ---------- menú de un mensaje: privado / reportar / bloquear ----------
  function closeMenu() {
    menu.hidden = true;
    menu.replaceChildren();
  }

  function openMenu(m, { dm }) {
    menu.replaceChildren();
    const card = el('div', 'chat-menu-card');
    card.appendChild(el('p', 'chat-menu-quote', `«${m.text}»`));
    card.appendChild(el('p', 'chat-sub', `de ${m.from.name}`));
    if (!dm) card.appendChild(button('btn btn-secondary', `✉️ Mensaje privado a ${m.from.name}`, () => { closeMenu(); openThread(m.from.id); }));
    card.appendChild(button('btn btn-secondary', '🚩 Reportar mensaje', () => reportMenu(m)));
    card.appendChild(button('btn btn-danger', `🚫 Bloquear a ${m.from.name}`, () => confirmBlock(m.from)));
    card.appendChild(button('chat-cancel', 'Cancelar', closeMenu));
    menu.appendChild(card);
    menu.hidden = false;
    FX.enter(card);
  }

  function reportMenu(m) {
    menu.replaceChildren();
    const card = el('div', 'chat-menu-card');
    card.appendChild(el('p', 'chat-menu-title', '¿Por qué lo reportas?'));
    for (const [key, label] of REASONS) {
      card.appendChild(
        button('btn btn-secondary', label, async () => {
          try {
            await api.post('/api/chat/report', { messageId: m.id, reason: key });
            for (const arr of [state.lobby, state.match ? state.match.messages : [], state.thread ? state.thread.messages : []]) {
              const i = arr.findIndex((x) => x.id === m.id);
              if (i >= 0) arr.splice(i, 1);
            }
            closeMenu();
            render();
            flash('Gracias. Lo revisaremos. También puedes bloquear a este jugador.');
          } catch (err) {
            flash(err.message);
          }
        })
      );
    }
    card.appendChild(button('chat-cancel', 'Cancelar', closeMenu));
    menu.appendChild(card);
  }

  function confirmBlock(p) {
    menu.replaceChildren();
    const card = el('div', 'chat-menu-card');
    card.appendChild(el('p', 'chat-menu-title', `¿Bloquear a ${p.name}?`));
    card.appendChild(el('p', 'chat-sub', 'No verás sus mensajes y no podrá escribirte en privado. Puedes deshacerlo en Ajustes.'));
    card.appendChild(
      button('btn btn-danger', 'Bloquear', async () => {
        try {
          await api.post(`/api/chat/block/${p.id}`, {});
          const keep = (arr) => arr.filter((x) => x.from.id !== p.id);
          state.lobby = keep(state.lobby);
          if (state.match) state.match.messages = keep(state.match.messages);
          state.convs = state.convs.filter((c) => c.with.id !== p.id);
          if (state.thread && state.thread.with.id === p.id) state.thread = null;
          state.settings = await api.get('/api/chat/settings');
          closeMenu();
          render();
          flash(`Has bloqueado a ${p.name}.`);
        } catch (err) {
          flash(err.message);
        }
      })
    );
    card.appendChild(button('chat-cancel', 'Cancelar', closeMenu));
    menu.replaceChildren(card);
    menu.hidden = false;
  }

  async function unblock(p) {
    try {
      await api.request(`/api/chat/block/${p.id}`, { method: 'DELETE' });
      state.settings = await api.get('/api/chat/settings');
      if (state.thread && state.thread.with.id === p.id) await openThread(p.id, true);
      else render();
      flash(`${p.name} ya no está bloqueado.`);
    } catch (err) {
      flash(err.message);
    }
  }

  function flash(text) {
    const f = el('div', 'chat-flash', text);
    panel.appendChild(f);
    setTimeout(() => f.remove(), 3500);
  }

  // ---------- datos ----------
  async function openThread(otherId, keepTab) {
    state.tab = 'dm';
    if (!keepTab) toggle(true);
    try {
      const t = await api.get(`/api/chat/dm/${otherId}`);
      state.thread = t;
      const c = state.convs.find((x) => x.with.id === otherId);
      if (c) {
        state.unreadDm = Math.max(0, state.unreadDm - c.unread);
        c.unread = 0;
      }
      render();
    } catch (err) {
      flash(err.message);
    }
  }

  async function send(text) {
    const value = String(text || '').trim();
    if (!value) return;
    try {
      if (state.tab === 'match' && state.match) {
        state.match.send({ t: 'chat', text: value });
      } else if (state.tab === 'general') {
        const r = await api.post('/api/chat/lobby', { text: value });
        merge(state.lobby, [r.message]);
      } else if (state.thread) {
        const r = await api.post(`/api/chat/dm/${state.thread.with.id}`, { text: value });
        merge(state.thread.messages, [r.message]);
      } else return;
      input.value = '';
      paintCounter();
      render();
      input.focus();
    } catch (err) {
      flash(err.message);
      if (err.status === 403) loadSettings();
    }
  }

  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    send(input.value);
  });
  function paintCounter() {
    const left = MAX - input.value.length;
    counter.textContent = left <= 40 ? String(left) : '';
  }
  input.addEventListener('input', paintCounter);

  async function loadSettings() {
    try {
      state.settings = await api.get('/api/chat/settings');
    } catch {
      // sin ajustes: se reintenta en el siguiente sondeo
    }
  }

  async function poll(force = false) {
    if (!Player.has() || Player.guest || document.hidden) return;
    const now = Date.now();
    try {
      if (state.open) {
        if (!force && now - state.lastPoll < POLL_OPEN_MS) return;
        state.lastPoll = now;
        if (!state.settings) await loadSettings();
        if (state.tab === 'general') {
          const last = state.lobby[state.lobby.length - 1];
          const r = await api.get(`/api/chat/lobby${last ? `?after=${encodeURIComponent(last.at)}` : ''}`);
          const before = state.lobby.length;
          merge(state.lobby, r.messages);
          if (state.lobby.length !== before || force) render();
        } else if (state.tab === 'dm' && state.thread) {
          const t = state.thread;
          const last = t.messages[t.messages.length - 1];
          const r = await api.get(`/api/chat/dm/${t.with.id}${last ? `?after=${encodeURIComponent(last.at)}` : ''}`);
          const before = t.messages.length;
          merge(t.messages, r.messages);
          const changed = t.canWrite !== r.canWrite || t.blocked !== r.blocked;
          Object.assign(t, { canWrite: r.canWrite, reason: r.reason, blocked: r.blocked });
          if (t.messages.length !== before || changed) render();
        } else if (state.tab === 'dm') {
          await loadInbox(force);
        }
      } else {
        if (!force && now - state.lastClosedPoll < POLL_CLOSED_MS) return;
        state.lastClosedPoll = now;
        await loadInbox(false);
      }
    } catch (err) {
      if (err.status === 401) btn.hidden = true;
    }
  }

  async function loadInbox(repaint) {
    const r = await api.get('/api/chat/dm');
    const prev = state.unreadDm;
    const signature = JSON.stringify(r.conversations.map((c) => [c.with.id, c.last.id, c.unread]));
    const changed = signature !== state.convSig;
    state.convSig = signature;
    state.convs = r.conversations;
    state.unreadDm = r.unread;
    if (r.unread > prev) {
      const c = r.conversations.find((x) => x.unread);
      if (c) {
        showToast(`✉️ ${c.with.name}: ${c.last.text}`, 'dm', c.with.id);
        FX.play('tick');
      }
    }
    paintBadges();
    if (state.open && state.tab === 'dm' && !state.thread && (changed || repaint)) {
      // No repintar mientras escribe en el buscador.
      if (document.activeElement && document.activeElement.classList.contains('chat-search') && !repaint) return;
      render();
      const s = body.querySelector('.chat-search');
      if (repaint && s && state.searching) s.focus();
    }
  }

  // ---------- chat de partida (lo usan online.js y conquista.js) ----------
  const match = {
    // Se puede llamar varias veces: solo la primera crea la pestaña.
    start(sendFn) {
      if (state.match) {
        state.match.send = sendFn;
        return;
      }
      state.match = { send: sendFn, messages: [], unread: 0 };
      if (!state.open) state.tab = 'match';
      paintBadges();
      if (state.open) render();
    },
    receive(message) {
      if (!state.match || !message) return;
      merge(state.match.messages, [message]);
      const mine = message.from.id === me();
      if (state.open && state.tab === 'match') render();
      else if (!mine) {
        state.match.unread += 1;
        paintBadges();
        showToast(`💬 ${message.from.name}: ${message.text}`, 'match');
        FX.play('tick');
      }
    },
    end() {
      state.match = null;
      if (state.tab === 'match') state.tab = 'general';
      paintBadges();
      if (state.open) render();
    },
  };

  // ---------- arranque ----------
  function boot() {
    if (!mount()) return;
    const check = () => {
      btn.hidden = !Player.has() || Player.guest;
      if (!btn.hidden) poll();
    };
    check();
    setInterval(check, 1000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) poll(true);
    });
  }

  window.Chat = { match, open: () => toggle(true), openThread };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
  else setTimeout(boot, 0);
})();
