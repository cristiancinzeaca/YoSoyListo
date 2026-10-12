// Pequeño cliente para la API del backend (mismo dominio que la web).
const api = {
  async request(path, options = {}) {
    let res;
    try {
      res = await fetch(path, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
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
};

const CATEGORY_NAMES = {
  general: 'Cultura general',
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

const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // modo privado o almacenamiento bloqueado: no pasa nada
    }
  },
};
