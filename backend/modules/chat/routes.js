const express = require('express');
const { requireAdmin } = require('../../core/http');
const { rateLimit } = require('../../core/rateLimit');
const { requirePlayer } = require('../players/auth');
const service = require('./service');

const router = express.Router();

// ---------- administración (cabecera X-Admin-Key) ----------
router.get('/admin/reports', requireAdmin, async (req, res) => {
  res.json(await service.listReports());
});

router.post('/admin/reports/:id', requireAdmin, async (req, res) => {
  const action = ['dismiss', 'hide', 'mute'].includes(req.body?.action) ? req.body.action : 'hide';
  res.json(await service.resolveReport(req.params.id, action));
});

// ---------- jugadores ----------
router.use(requirePlayer);

router.get('/lobby', rateLimit({ windowMs: 60_000, max: 90 }), async (req, res) => {
  res.json(await service.lobby(req.player.id, req.query.after));
});

router.post('/lobby', rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  res.status(201).json(await service.postLobby(req.player.id, req.body?.text));
});

router.get('/dm', rateLimit({ windowMs: 60_000, max: 90 }), async (req, res) => {
  res.json(await service.conversations(req.player.id));
});

router.get('/dm/:id', rateLimit({ windowMs: 60_000, max: 90 }), async (req, res) => {
  res.json(await service.thread(req.player.id, req.params.id, req.query.after));
});

router.post('/dm/:id', rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  res.status(201).json(await service.postDm(req.player.id, req.params.id, req.body?.text));
});

router.post('/report', rateLimit({ windowMs: 60 * 60_000, max: 30 }), async (req, res) => {
  res.status(201).json(await service.report(req.player.id, req.body?.messageId, req.body?.reason));
});

router.post('/block/:id', rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  res.json(await service.block(req.player.id, req.params.id));
});

router.delete('/block/:id', rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  res.json(await service.unblock(req.player.id, req.params.id));
});

router.get('/settings', async (req, res) => {
  res.json(await service.settings(req.player.id));
});

router.patch('/settings', rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  res.json(await service.setDmOpen(req.player.id, req.body?.dmOpen));
});

router.get('/search', rateLimit({ windowMs: 60_000, max: 40 }), async (req, res) => {
  res.json(await service.search(req.player.id, req.query.name));
});

module.exports = router;
