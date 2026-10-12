const express = require('express');
const { requireAdmin, isUuid, httpError } = require('../../core/http');
const { rateLimit } = require('../../core/rateLimit');
const { optionalPlayer } = require('../players/auth');
const service = require('./service');

const router = express.Router();

// Pública: la usa la web para el selector de categorías.
router.get('/categories', async (req, res) => {
  res.json({ categories: await service.categories() });
});

router.param('id', (req, res, next, id) => {
  if (!isUuid(id)) return next(httpError(404, 'Pregunta no encontrada'));
  next();
});

// Pública: un jugador avisa de que una pregunta tiene un error.
router.post('/:id/report', rateLimit({ windowMs: 60 * 60_000, max: 15 }), optionalPlayer, async (req, res) => {
  await service.report(req.params.id, req.body?.reason, req.player?.id);
  res.status(201).json({ ok: true });
});

// Todo lo demás es solo para el panel de administración.
router.use(requireAdmin);

router.get('/reports', async (req, res) => {
  res.json({ items: await service.listReports() });
});

router.delete('/:id/reports', async (req, res) => {
  await service.clearReports(req.params.id);
  res.status(204).end();
});

router.get('/', async (req, res) => {
  res.json(await service.list(req.query));
});

router.post('/', async (req, res) => {
  res.status(201).json(await service.create(req.body));
});

router.post('/bulk', async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : req.body?.questions;
  res.status(201).json(await service.createMany(items));
});

router.put('/:id', async (req, res) => {
  res.json(await service.update(req.params.id, req.body));
});

router.delete('/:id', async (req, res) => {
  await service.remove(req.params.id);
  res.status(204).end();
});

module.exports = router;
