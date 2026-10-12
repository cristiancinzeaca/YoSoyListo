const express = require('express');
const { rateLimit } = require('../../core/rateLimit');
const { requirePlayer } = require('./auth');
const service = require('./service');

const router = express.Router();

// Los perfiles de invitado ya no se crean: hay que entrar con Google.
router.post('/', (req, res) => {
  res.status(410).json({ error: 'Ahora se juega con cuenta: entra con Google', code: 'login' });
});

router.get('/leaderboard', async (req, res) => {
  res.json({ entries: await service.leaderboard(req.query.limit, req.query.mode === 'conquista' ? 'conquista' : 'duel') });
});

router.get('/me', requirePlayer, async (req, res) => {
  res.json(await service.profile(req.player));
});

router.patch('/me', requirePlayer, rateLimit({ windowMs: 60 * 60_000, max: 20 }), async (req, res) => {
  res.json(await service.rename(req.player.id, req.body?.name));
});

module.exports = router;
