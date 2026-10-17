// Panel de administración: actividad (registros, partidas, quién está conectado).
const express = require('express');
const { requireAdmin } = require('../../core/http');
const { getDb, dbError } = require('../../core/db');
const live = require('../../core/live');
const { levelFromXp } = require('../heroes/catalog');

const router = express.Router();
router.use(requireAdmin);

router.get('/stats', async (req, res) => {
  const { data, error } = await getDb().rpc('admin_stats');
  if (error) throw dbError(error, 'admin.stats');
  const stats = (data && data[0] && data[0].stats) || {};
  for (const p of stats.recent_players || []) p.level = levelFromXp(p.xp).level;
  res.json({ ...stats, online: live.stats(), at: new Date().toISOString() });
});

module.exports = router;
