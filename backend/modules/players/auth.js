const { httpError } = require('../../core/http');
const players = require('./service');

function bearer(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

// Si la petición trae un token válido, deja el jugador en req.player.
async function optionalPlayer(req, res, next) {
  const token = bearer(req);
  req.player = token ? await players.findByToken(token) : null;
  next();
}

async function requirePlayer(req, res, next) {
  const token = bearer(req);
  req.player = token ? await players.findByToken(token) : null;
  if (!req.player) return next(httpError(401, 'Perfil no válido, vuelve a crear tu nombre'));
  next();
}

module.exports = { optionalPlayer, requirePlayer };
