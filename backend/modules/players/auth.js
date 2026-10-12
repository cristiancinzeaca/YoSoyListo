const { httpError } = require('../../core/http');
const players = require('./service');

function bearer(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

function loginError() {
  const err = httpError(401, 'Entra con tu cuenta de Google para jugar');
  err.code = 'login';
  return err;
}

// Si la petición trae una sesión válida, deja el jugador en req.player.
async function optionalPlayer(req, res, next) {
  const token = bearer(req);
  const player = token ? await players.findByToken(token) : null;
  req.player = player && player.hasAccount ? player : null;
  next();
}

// Exige haber entrado con Google (los perfiles de invitado antiguos ya no valen para jugar).
async function requirePlayer(req, res, next) {
  const token = bearer(req);
  const player = token ? await players.findByToken(token) : null;
  if (!player || !player.hasAccount) return next(loginError());
  req.player = player;
  req.token = token;
  next();
}

module.exports = { optionalPlayer, requirePlayer, bearer };
