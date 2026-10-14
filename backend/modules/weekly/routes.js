const express = require('express');
const { optionalPlayer, requirePlayer } = require('../players/auth');
const service = require('./service');

const router = express.Router();

router.get('/', optionalPlayer, async (req, res) => {
  res.json(await service.state(req.player ? req.player.id : null));
});

router.post('/seen', requirePlayer, async (req, res) => {
  res.json(await service.markSeen(req.player.id));
});

module.exports = router;
