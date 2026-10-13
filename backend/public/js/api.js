// Pequeño cliente para la API del backend (mismo dominio que la web).
const api = {
  async request(path, options = {}) {
    let res;
    try {
      const token = storage.get('ysl:token');
      res = await fetch(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers || {}),
        },
      });
    } catch {
      throw new Error('No hay conexión con el servidor');
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      // respuesta sin cuerpo
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Error ${res.status}`);
      err.status = res.status;
      err.code = data && data.code;
      throw err;
    }
    return data;
  },
  get(path) {
    return this.request(path);
  },
  post(path, body) {
    return this.request(path, { method: 'POST', body: JSON.stringify(body || {}) });
  },
  patch(path, body) {
    return this.request(path, { method: 'PATCH', body: JSON.stringify(body || {}) });
  },
};

const CATEGORY_NAMES = {
  general: 'Cultura general',
  x18_anatomia: '🔞 Anatomía',
  x18_sexo: '🔞 Sexo',
  x18_salud: '🔞 Salud sexual',
  x18_reproduccion: '🔞 Reproducción',
  x18_historia: '🔞 Historia del sexo',
  x18_curiosidades: '🔞 Curiosidades',
  geografia: 'Geografía',
  historia: 'Historia',
  ciencia: 'Ciencia',
  arte: 'Arte y literatura',
  deportes: 'Deportes',
};

function categoryLabel(slug) {
  if (!slug) return 'Todas las categorías';
  if (CATEGORY_NAMES[slug]) return CATEGORY_NAMES[slug];
  const text = slug.replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const memory = {};
const storage = {
  get(key) {
    try {
      const value = localStorage.getItem(key);
      if (value !== null) return value;
    } catch {
      // nada
    }
    return memory[key] ?? null;
  },
  set(key, value) {
    memory[key] = value;
    try {
      localStorage.setItem(key, value);
    } catch {
      // modo privado o almacenamiento bloqueado: se guarda solo mientras dure la página
    }
  },
  remove(key) {
    delete memory[key];
    try {
      localStorage.removeItem(key);
    } catch {
      // nada
    }
  },
};

// Avisar de un error en una pregunta (botón «⚑» en los resultados).
async function reportQuestion(questionId) {
  const reason = window.prompt('¿Qué error tiene esta pregunta? (por ejemplo: «la respuesta correcta es otra»)');
  if (!reason || reason.trim().length < 2) return;
  try {
    await api.post(`/api/questions/${questionId}/report`, { reason: reason.trim() });
    window.alert('¡Gracias! Lo revisaremos.');
  } catch (err) {
    window.alert(err.message);
  }
}
