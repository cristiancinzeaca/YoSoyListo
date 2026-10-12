const { httpError } = require('./http');

// Límite de peticiones en memoria por IP. Suficiente para una sola instancia;
// si algún día hay varias, habrá que moverlo a Redis o a la base de datos.
function rateLimit({ windowMs, max }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(ip);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || 'unknown';
    let entry = hits.get(ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(ip, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return next(httpError(429, 'Demasiadas peticiones, espera un momento'));
    }
    next();
  };
}

module.exports = { rateLimit };
