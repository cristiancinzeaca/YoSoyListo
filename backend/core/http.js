const crypto = require('crypto');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Protege las rutas del panel de administración con la cabecera X-Admin-Key.
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_KEY;
  if (!expected) {
    return next(httpError(503, 'ADMIN_KEY no está configurada en el servidor'));
  }
  const given = req.get('x-admin-key');
  if (!given || !safeEqual(given, expected)) {
    return next(httpError(401, 'Clave de administrador incorrecta'));
  }
  next();
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  let status = err.status || err.statusCode || 500;
  let message = err.message;
  if (err.type === 'entity.parse.failed') message = 'JSON inválido';
  if (err.type === 'entity.too.large') message = 'Petición demasiado grande';
  if (status >= 500) {
    console.error(`[${req.method} ${req.originalUrl}]`, err.context || '', err.cause || err);
    if (status === 500) message = 'Error interno del servidor';
  }
  res.status(status).json({ error: message });
}

module.exports = { httpError, isUuid, requireAdmin, errorHandler };
