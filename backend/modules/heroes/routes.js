const express = require('express');
const { rateLimit } = require('../../core/rateLimit');
const { requirePlayer } = require('../players/auth');
const service = require('./service');

const router = express.Router();

router.get('/catalog', (req, res) => {
  res.json(service.catalog());
});

router.get('/me', requirePlayer, async (req, res) => {
  res.json(await service.me(req.player.id));
});

router.post('/me', requirePlayer, rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  res.json(await service.create(req.player.id, req.body));
});

router.post('/equip', requirePlayer, rateLimit({ windowMs: 60_000, max: 60 }), async (req, res) => {
  res.json(await service.equip(req.player.id, req.body));
});

module.exports = router;
