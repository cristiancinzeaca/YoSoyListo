const express = require('express');
const { rateLimit } = require('../../core/rateLimit');
const { requirePlayer } = require('../players/auth');
const service = require('./service');

const router = express.Router();
router.use(requirePlayer);

router.get('/', async (req, res) => {
  res.json(await service.overview(req.player.id));
});

router.post('/nodes/:id/read', rateLimit({ windowMs: 60_000, max: 60 }), async (req, res) => {
  res.json(await service.read(req.player.id, req.params.id));
});

router.post('/nodes/:id/start', rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  res.status(201).json(await service.start(req.player.id, req.params.id));
});

router.post('/runs/:rid/answer', rateLimit({ windowMs: 60_000, max: 120 }), async (req, res) => {
  res.json(await service.answer(req.player.id, req.params.rid, req.body));
});

module.exports = router;
