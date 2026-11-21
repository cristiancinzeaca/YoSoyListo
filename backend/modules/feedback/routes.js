// Sugerencias de los jugadores: el perfil las envía y el panel de admin las lee.
const express = require('express');
const { requireAdmin, isUuid, httpError } = require('../../core/http');
const { getDb, dbError } = require('../../core/db');
const { rateLimit } = require('../../core/rateLimit');
const { optionalPlayer } = require('../players/auth');

const router = express.Router();

router.post('/', rateLimit({ windowMs: 60 * 60_000, max: 5 }), optionalPlayer, async (req, res) => {
  const message = String(req.body?.message || '').trim();
  const contact = String(req.body?.contact || '').trim().slice(0, 120) || null;
  const source = /YoSoyListoApp/.test(req.get('user-agent') || '') ? 'android' : 'web';
  if (message.length < 5) throw httpError(400, 'Escribe un poco más (mínimo 5 letras)');
  if (message.length > 1000) throw httpError(400, 'Máximo 1000 caracteres');
  const { error } = await getDb().from('feedback').insert({ player_id: req.player?.id || null, message, contact, source });
  if (error) throw dbError(error, 'feedback.create');
  res.status(201).json({ ok: true });
});

router.get('/', requireAdmin, async (req, res) => {
  const { data, error } = await getDb().from('feedback').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) throw dbError(error, 'feedback.list');
  const ids = [...new Set((data || []).map((f) => f.player_id).filter(Boolean))];
  let names = {};
  if (ids.length) {
    const { data: players } = await getDb().from('players').select('id, name').in('id', ids);
    names = Object.fromEntries((players || []).map((p) => [p.id, p.name]));
  }
  res.json({ items: (data || []).map((f) => ({ ...f, player_name: names[f.player_id] || null })) });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  if (!isUuid(req.params.id)) throw httpError(400, 'id no válido');
  const { error } = await getDb().from('feedback').delete().eq('id', req.params.id);
  if (error) throw dbError(error, 'feedback.delete');
  res.json({ ok: true });
});

module.exports = router;
