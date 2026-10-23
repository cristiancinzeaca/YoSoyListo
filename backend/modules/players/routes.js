const express = require('express');
const { rateLimit } = require('../../core/rateLimit');
const { requirePlayer } = require('./auth');
const service = require('./service');
const shop = require('../shop/service');

const router = express.Router();

// Los perfiles de invitado ya no se crean: hay que entrar con Google.
router.post('/', (req, res) => {
  res.status(410).json({ error: 'Ahora se juega con cuenta: entra con Google', code: 'login' });
});

// Portales de juegos: se juega al momento, sin registrarse (una cuenta anónima por navegador).
router.post('/portal', rateLimit({ windowMs: 60 * 60_000, max: 60 }), async (req, res) => {
  res.status(201).json(await service.createPortal(String(req.body?.source || ''), { onCreated: shop.grantWelcome }));
});

router.get('/leaderboard', async (req, res) => {
  res.json({ entries: await service.leaderboard(req.query.limit, req.query.mode === 'conquista' ? 'conquista' : 'duel') });
});

// ¿Está libre un nombre? (para avisar mientras se escribe)
router.get('/name-check', requirePlayer, rateLimit({ windowMs: 60_000, max: 60 }), async (req, res) => {
  res.json(await service.checkName(String(req.query.name || ''), req.player));
});

router.post('/birthdate', requirePlayer, rateLimit({ windowMs: 60 * 60_000, max: 10 }), async (req, res) => {
  res.json(await service.setBirthdate(req.player.id, req.body?.date));
});

router.get('/me', requirePlayer, async (req, res) => {
  res.json(await service.profile(req.player));
});

router.patch('/me', requirePlayer, rateLimit({ windowMs: 60 * 60_000, max: 20 }), async (req, res) => {
  res.json(await service.rename(req.player.id, req.body?.name));
});

module.exports = router;
