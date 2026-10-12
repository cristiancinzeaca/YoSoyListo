const express = require('express');
const { isUuid, httpError } = require('../../core/http');
const { rateLimit } = require('../../core/rateLimit');
const { BLITZ } = require('./logic');
const { optionalPlayer } = require('../players/auth');
const service = require('./service');

const router = express.Router();

router.param('id', (req, res, next, id) => {
  if (!isUuid(id)) return next(httpError(404, 'Partida no encontrada'));
  next();
});

router.get('/config', (req, res) => {
  res.json({
    durationMs: BLITZ.durationMs,
    basePoints: BLITZ.basePoints,
    streakStep: BLITZ.streakStep,
    maxMultiplier: BLITZ.maxMultiplier,
  });
});

router.get('/leaderboard', async (req, res) => {
  const period = req.query.period === 'all' ? 'all' : 'week';
  res.json({ period, entries: await service.leaderboard({ period, limit: req.query.limit }) });
});

router.post('/start', rateLimit({ windowMs: 60_000, max: 20 }), optionalPlayer, async (req, res) => {
  res.status(201).json(await service.start({ category: req.body?.category, playerId: req.player?.id }));
});

router.post('/:id/answer', rateLimit({ windowMs: 60_000, max: 300 }), async (req, res) => {
  res.json(await service.answer(req.params.id, req.body));
});

router.post('/:id/finish', rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  res.json(await service.finish(req.params.id, req.body));
});

module.exports = router;
