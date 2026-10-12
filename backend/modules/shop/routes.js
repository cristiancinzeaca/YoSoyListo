const express = require('express');
const { rateLimit } = require('../../core/rateLimit');
const { requirePlayer } = require('../players/auth');
const service = require('./service');

const router = express.Router();

router.get('/catalog', (req, res) => {
  res.json(service.catalog());
});

router.get('/me', requirePlayer, async (req, res) => {
  res.json(await service.wallet(req.player.id));
});

router.post('/buy', requirePlayer, rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  res.json(await service.buy(req.player.id, req.body?.item));
});

router.post('/avatar', requirePlayer, rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  res.json(await service.setAvatar(req.player.id, req.body?.avatar));
});

module.exports = router;
