const express = require('express');
const { rateLimit } = require('../../core/rateLimit');
const { requirePlayer } = require('./auth');
const service = require('./service');

const router = express.Router();

router.post('/', rateLimit({ windowMs: 60 * 60_000, max: 20 }), async (req, res) => {
  res.status(201).json(await service.create(req.body?.name));
});

router.get('/leaderboard', async (req, res) => {
  res.json({ entries: await service.leaderboard(req.query.limit) });
});

router.get('/me', requirePlayer, async (req, res) => {
  res.json(await service.profile(req.player));
});

router.patch('/me', requirePlayer, rateLimit({ windowMs: 60 * 60_000, max: 20 }), async (req, res) => {
  res.json(await service.rename(req.player.id, req.body?.name));
});

module.exports = router;
