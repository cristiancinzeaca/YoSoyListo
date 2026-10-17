// Datos en vivo del servidor de partidas (conexiones, salas) para el panel de administración.
let statsFn = null;
module.exports = {
  setStats(fn) {
    statsFn = fn;
  },
  stats() {
    try {
      return statsFn ? statsFn() : null;
    } catch {
      return null;
    }
  },
};
