(function () {
  const $ = (id) => document.getElementById(id);
  const MAX_OPTIONS = 6;
  const PAGE_SIZE = 20;

  const store = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  const sameOrigin = /^https?:$/.test(location.protocol) ? location.origin : '';
  const cfg = {
    url: store.get('ysl-admin:url') || sameOrigin,
    key: store.get('ysl-admin:key'),
  };
  $('cfg-url').value = cfg.url;
  $('cfg-key').value = cfg.key;

  let editingId = null;
  let page = 1;
  let total = 0;
  let items = [];

  function message(el, text, ok) {
    el.replaceChildren();
    if (!text) return;
    const div = document.createElement('div');
    div.className = `msg ${ok ? 'ok' : 'err'}`;
    div.textContent = text;
    el.appendChild(div);
  }

  async function api(path, options = {}) {
    if (!cfg.url) throw new Error('Configura primero la URL del backend');
    let res;
    try {
      res = await fetch(cfg.url.replace(/\/+$/, '') + path, {
        ...options,
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': cfg.key, ...(options.headers || {}) },
      });
    } catch {
      throw new Error('No se puede conectar con el backend. Revisa la URL.');
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error((data && data.error) || `Error ${res.status}`);
    return data;
  }

  // ---------- Conexión ----------
  $('cfg-save').addEventListener('click', async () => {
    cfg.url = $('cfg-url').value.trim().replace(/\/+$/, '').replace(/\/health$/, '');
    cfg.key = $('cfg-key').value;
    $('cfg-url').value = cfg.url;
    store.set('ysl-admin:url', cfg.url);
    store.set('ysl-admin:key', cfg.key);
    const status = $('cfg-status');
    status.className = 'status';
    status.textContent = 'Comprobando…';
    try {
      await api('/api/questions?pageSize=1');
      status.className = 'status ok';
      status.textContent = '✓ Conectado';
      page = 1;
      loadList();
      loadReports();
    } catch (err) {
      status.className = 'status err';
      status.textContent = err.message;
    }
  });

  // ---------- Formulario ----------
  function addOptionRow(value = '', checked = false) {
    const container = $('q-options');
    if (container.children.length >= MAX_OPTIONS) return;
    const row = document.createElement('div');
    row.className = 'option-row';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'correct';
    radio.checked = checked;
    radio.title = 'Respuesta correcta';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 200;
    input.value = value;
    input.placeholder = `Opción ${container.children.length + 1}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger small';
    remove.textContent = '✕';
    remove.title = 'Quitar opción';
    remove.addEventListener('click', () => {
      if (container.children.length > 2) row.remove();
      updateAddButton();
    });
    row.append(radio, input, remove);
    container.appendChild(row);
    updateAddButton();
  }

  function updateAddButton() {
    $('add-option').disabled = $('q-options').children.length >= MAX_OPTIONS;
  }

  function resetForm() {
    editingId = null;
    $('q-form').reset();
    $('q-options').replaceChildren();
    for (let i = 0; i < 4; i++) addOptionRow('', i === 0);
    $('q-difficulty').value = '2';
    $('q-active').checked = true;
    $('form-title').textContent = 'Nueva pregunta';
    $('q-submit').textContent = 'Añadir pregunta';
    $('q-cancel').hidden = true;
  }

  function readForm() {
    const rows = [...$('q-options').children];
    const options = [];
    let correctIndex = -1;
    for (const row of rows) {
      const [radio, input] = row.querySelectorAll('input');
      const value = input.value.trim();
      if (!value) continue;
      if (radio.checked) correctIndex = options.length;
      options.push(value);
    }
    return {
      text: $('q-text').value.trim(),
      options,
      correctIndex,
      category: $('q-category').value.trim() || 'general',
      difficulty: Number($('q-difficulty').value),
      explanation: $('q-explanation').value.trim() || null,
      active: $('q-active').checked,
    };
  }

  function fillForm(q) {
    editingId = q.id;
    $('q-text').value = q.text;
    $('q-options').replaceChildren();
    q.options.forEach((o, i) => addOptionRow(o, i === q.correctIndex));
    $('q-category').value = q.category;
    $('q-difficulty').value = String(q.difficulty);
    $('q-explanation').value = q.explanation || '';
    $('q-active').checked = q.active;
    $('form-title').textContent = 'Editar pregunta';
    $('q-submit').textContent = 'Guardar cambios';
    $('q-cancel').hidden = false;
    message($('form-msg'), '');
    $('form-title').scrollIntoView({ behavior: 'smooth' });
  }

  $('add-option').addEventListener('click', () => addOptionRow());
  $('q-cancel').addEventListener('click', () => { resetForm(); message($('form-msg'), ''); });

  $('q-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const q = readForm();
    if (q.options.length < 2) return message($('form-msg'), 'Escribe al menos 2 opciones', false);
    if (q.correctIndex < 0) return message($('form-msg'), 'Marca cuál es la opción correcta', false);
    $('q-submit').disabled = true;
    try {
      if (editingId) {
        await api(`/api/questions/${editingId}`, { method: 'PUT', body: JSON.stringify(q) });
        message($('form-msg'), '✓ Pregunta actualizada', true);
      } else {
        await api('/api/questions', { method: 'POST', body: JSON.stringify(q) });
        message($('form-msg'), '✓ Pregunta añadida', true);
      }
      const keepCategory = q.category;
      resetForm();
      $('q-category').value = keepCategory;
      loadList();
    } catch (err) {
      message($('form-msg'), err.message, false);
    } finally {
      $('q-submit').disabled = false;
    }
  });

  // ---------- Importación ----------
  $('bulk-import').addEventListener('click', async () => {
    let parsed;
    try {
      parsed = JSON.parse($('bulk-json').value);
    } catch {
      return message($('bulk-msg'), 'El JSON no es válido', false);
    }
    $('bulk-import').disabled = true;
    try {
      const res = await api('/api/questions/bulk', { method: 'POST', body: JSON.stringify(parsed) });
      message($('bulk-msg'), `✓ ${res.inserted} preguntas importadas`, true);
      $('bulk-json').value = '';
      page = 1;
      loadList();
    } catch (err) {
      message($('bulk-msg'), err.message, false);
    } finally {
      $('bulk-import').disabled = false;
    }
  });

  // ---------- Listado ----------
  const DIFFICULTY = { 1: 'Fácil', 2: 'Media', 3: 'Difícil' };

  function renderList() {
    const list = $('q-list');
    list.replaceChildren();
    for (const q of items) {
      const item = document.createElement('div');
      item.className = 'q-item';

      const text = document.createElement('div');
      text.className = 'q-text';
      text.textContent = q.text;

      const meta = document.createElement('div');
      meta.className = 'q-meta';
      const cat = document.createElement('span');
      cat.className = 'badge';
      cat.textContent = q.category;
      meta.append(cat, `${DIFFICULTY[q.difficulty]} `);
      if (!q.active) {
        const off = document.createElement('span');
        off.className = 'badge off';
        off.textContent = 'inactiva';
        meta.appendChild(off);
      }

      const opts = document.createElement('ol');
      opts.className = 'q-opts';
      q.options.forEach((o, i) => {
        const li = document.createElement('li');
        li.textContent = o;
        if (i === q.correctIndex) li.className = 'correct';
        opts.appendChild(li);
      });

      const actions = document.createElement('div');
      actions.className = 'actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'secondary small';
      edit.textContent = 'Editar';
      edit.addEventListener('click', () => fillForm(q));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'danger small';
      del.textContent = 'Borrar';
      del.addEventListener('click', async () => {
        if (!confirm(`¿Borrar esta pregunta?\n\n${q.text}`)) return;
        try {
          await api(`/api/questions/${q.id}`, { method: 'DELETE' });
          if (editingId === q.id) resetForm();
          if (items.length === 1 && page > 1) page -= 1;
          loadList();
        } catch (err) {
          message($('list-msg'), err.message, false);
        }
      });
      actions.append(edit, del);

      item.append(text, meta, opts, actions);
      list.appendChild(item);
    }
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'No hay preguntas.';
      list.appendChild(empty);
    }
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    $('list-total').textContent = `(${total})`;
    $('page-info').textContent = `Página ${page} de ${pages}`;
    $('prev-page').disabled = page <= 1;
    $('next-page').disabled = page >= pages;
  }

  async function loadList() {
    if (!cfg.url || !cfg.key) return;
    const params = new URLSearchParams({ page, pageSize: PAGE_SIZE });
    const search = $('filter-search').value.trim();
    const category = $('filter-category').value.trim();
    if (search) params.set('search', search);
    if (category) params.set('category', category);
    try {
      const data = await api(`/api/questions?${params}`);
      items = data.items;
      total = data.total;
      message($('list-msg'), '');
      renderList();
    } catch (err) {
      message($('list-msg'), err.message, false);
    }
  }

  let filterTimer;
  function onFilter() {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { page = 1; loadList(); }, 300);
  }
  $('filter-search').addEventListener('input', onFilter);
  $('filter-category').addEventListener('input', onFilter);
  $('prev-page').addEventListener('click', () => { page -= 1; loadList(); });
  $('next-page').addEventListener('click', () => { page += 1; loadList(); });

  // ---------- Avisos de errores ----------
  async function loadReports() {
    if (!cfg.url || !cfg.key) return;
    const box = $('reports');
    try {
      const { items: groups } = await api('/api/questions/reports');
      box.replaceChildren();
      $('reports-total').textContent = `(${groups.length})`;
      if (groups.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = 'No hay avisos pendientes. 🎉';
        box.appendChild(empty);
      }
      for (const g of groups) {
        const item = document.createElement('div');
        item.className = 'q-item';
        const text = document.createElement('div');
        text.className = 'q-text';
        text.textContent = g.question.text;
        const opts = document.createElement('ol');
        opts.className = 'q-opts';
        g.question.options.forEach((o, i) => {
          const li = document.createElement('li');
          li.textContent = o;
          if (i === g.question.correctIndex) li.className = 'correct';
          opts.appendChild(li);
        });
        const reasons = document.createElement('ul');
        reasons.className = 'q-meta';
        for (const r of g.reports) {
          const li = document.createElement('li');
          li.textContent = `«${r.reason}» · ${new Date(r.createdAt).toLocaleString('es-ES')}`;
          reasons.appendChild(li);
        }
        const actions = document.createElement('div');
        actions.className = 'actions';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'secondary small';
        edit.textContent = 'Editar';
        edit.addEventListener('click', () => fillForm(g.question));
        const done = document.createElement('button');
        done.type = 'button';
        done.className = 'small';
        done.textContent = 'Resuelto';
        done.addEventListener('click', async () => {
          try {
            await api(`/api/questions/${g.question.id}/reports`, { method: 'DELETE' });
            loadReports();
          } catch (err) {
            message($('reports-msg'), err.message, false);
          }
        });
        actions.append(edit, done);
        item.append(text, opts, reasons, actions);
        box.appendChild(item);
      }
      message($('reports-msg'), '');
    } catch (err) {
      message($('reports-msg'), err.message, false);
    }
  }

  resetForm();
  loadList();
  loadReports();
})();
