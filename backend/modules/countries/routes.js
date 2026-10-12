const express = require('express');
const { isUuid, httpError } = require('../../core/http');
const { rateLimit } = require('../../core/rateLimit');
const { requirePlayer } = require('../players/auth');
const service = require('./service');

const router = express.Router();

router.get('/', async (req, res) => {
  res.json({ countries: await service.list() });
});

router.get('/mine', requirePlayer, async (req, res) => {
  res.json(await service.mine(req.player.id));
});

router.post('/collect', requirePlayer, rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  res.json(await service.collect(req.player.id));
});

router.post('/attacks/:aid/answer', requirePlayer, rateLimit({ windowMs: 60_000, max: 120 }), async (req, res) => {
  if (!isUuid(req.params.aid)) throw httpError(404, 'Ataque no encontrado');
  res.json(await service.answerAttack(req.player.id, req.params.aid, req.body));
});

router.get('/:id/study', requirePlayer, async (req, res) => {
  res.json(await service.study(req.player.id, req.params.id));
});

router.post('/:id/buy', requirePlayer, rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  res.json(await service.buy(req.player.id, req.params.id));
});

router.post('/:id/defense', requirePlayer, rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  res.json(await service.setDefense(req.player.id, req.params.id, req.body?.seqs));
});

router.post('/:id/fortify', requirePlayer, rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  res.json(await service.fortify(req.player.id, req.params.id));
});

router.post('/:id/attack', requirePlayer, rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  res.status(201).json(await service.startAttack(req.player.id, req.params.id));
});

module.exports = router;
