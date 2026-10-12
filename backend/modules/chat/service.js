// Chat: sala general, chat de partida y mensajes privados.
// Los mensajes se guardan en chat_messages; la sala general y los privados se leen por la API
// (con sondeo cada pocos segundos) y el de partida llega en directo por el WebSocket.
const { getDb, dbError } = require('../../core/db');
const { httpError, isUuid } = require('../../core/http');
const { AVATARS } = require('../shop/catalog');
const { cleanMessage } = require('./filter');

const CHAT = {
  minGapMs: 1_500, // entre dos mensajes del mismo jugador
  burst: 6, // como mucho 6 mensajes…
  burstWindowMs: 30_000, // …cada 30 segundos
  repeatMs: 60_000, // no repetir el mismo mensaje en un minuto
  history: 50, // mensajes que se cargan de golpe
  hideAt: 3, // reportes distintos para ocultar un mensaje
  muteAfter: 3, // mensajes ocultados en 7 días para silenciar al autor
  muteHours: 24,
  keepPublicDays: 7,
  keepPrivateDays: 90,
  reasons: ['insultos', 'spam', 'inapropiado', 'acoso', 'otro'],
};

const LOBBY = 'lobby';
const dmChannel = (a, b) => `dm:${[a, b].sort().join(':')}`;
const matchChannel = (code) => `match:${code}`;

// ---------- límites de envío (en memoria: el servidor es una sola instancia) ----------
const recent = new Map(); // playerId → [{ at, text }]

function checkRate(playerId, text) {
  const now = Date.now();
  const list = (recent.get(playerId) || []).filter((m) => now - m.at < Math.max(CHAT.burstWindowMs, CHAT.repeatMs));
  const last = list[list.length - 1];
  if (last && now - last.at < CHAT.minGapMs) throw httpError(429, 'Más despacio: espera un momento antes de volver a escribir');
  if (list.filter((m) => now - m.at < CHAT.burstWindowMs).length >= CHAT.burst) {
    throw httpError(429, 'Has escrito muchos mensajes seguidos. Espera unos segundos');
  }
  if (list.some((m) => m.text === text && now - m.at < CHAT.repeatMs)) throw httpError(429, 'Ya has enviado ese mensaje');
  list.push({ at: now, text });
  recent.set(playerId, list);
}

// ---------- bloqueos (con caché en memoria) ----------
const blockCache = new Map(); // playerId → Set de ids bloqueados

async function blockedBy(playerId) {
  if (blockCache.has(playerId)) return blockCache.get(playerId);
  const { data, error } = await getDb().from('chat_blocks').select('blocked_id').eq('blocker_id', playerId);
  if (error) throw dbError(error, 'chat.blocks');
  const set = new Set(data.map((r) => r.blocked_id));
  blockCache.set(playerId, set);
  return set;
}

// ¿Ha bloqueado `viewer` a `sender`? (síncrono, para el WebSocket: usa la caché ya cargada)
function hides(viewerId, senderId) {
  const set = blockCache.get(viewerId);
  return !!(set && set.has(senderId));
}

// ---------- utilidades ----------
async function loadPlayers(ids) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const { data, error } = await getDb().from('players').select('id, name, avatar').in('id', unique);
  if (error) throw dbError(error, 'chat.players');
  return new Map(data.map((p) => [p.id, { id: p.id, name: p.name, avatar: p.avatar && AVATARS[p.avatar] ? p.avatar : null }]));
}

const iso = (v) => (v instanceof Date ? v.toISOString() : v);

function format(row, people) {
  return {
    id: row.id,
    from: people.get(row.sender_id) || { id: row.sender_id, name: '¿?', avatar: null },
    text: row.body,
    at: iso(row.created_at),
  };
}

async function senderRow(playerId) {
  const { data, error } = await getDb().from('players').select('id, name, avatar, chat_muted_until, dm_open').eq('id', playerId).maybeSingle();
  if (error) throw dbError(error, 'chat.sender');
  if (!data) throw httpError(404, 'Jugador no encontrado');
  return data;
}

function assertNotMuted(row) {
  const until = row.chat_muted_until ? Date.parse(iso(row.chat_muted_until)) : 0;
  if (until > Date.now()) {
    const hours = Math.ceil((until - Date.now()) / 3_600_000);
    throw httpError(403, `Tus mensajes han sido reportados varias veces. No puedes escribir en el chat durante ${hours} h.`);
  }
}

// Guarda un mensaje ya validado. Devuelve el mensaje con el formato público.
async function insertMessage(sender, channel, text, recipientId = null) {
  const { data, error } = await getDb()
    .from('chat_messages')
    .insert({ channel, sender_id: sender.id, recipient_id: recipientId, body: text })
    .select('*')
    .single();
  if (error) throw dbError(error, 'chat.insert');
  const people = new Map([[sender.id, { id: sender.id, name: sender.name, avatar: sender.avatar && AVATARS[sender.avatar] ? sender.avatar : null }]]);
  return format(data, people);
}

async function prepare(playerId, raw) {
  const { text, error } = cleanMessage(raw);
  if (error) throw httpError(400, error);
  const sender = await senderRow(playerId);
  assertNotMuted(sender);
  checkRate(playerId, text);
  return { sender, text };
}

// Mensajes de un canal (los más recientes, en orden), sin los de jugadores bloqueados.
async function readChannel(viewerId, channel, after) {
  let q = getDb().from('chat_messages').select('*').eq('channel', channel).eq('hidden', false);
  if (after && !Number.isNaN(Date.parse(after))) q = q.gte('created_at', new Date(Date.parse(after)).toISOString());
  const { data, error } = await q.order('created_at', { ascending: false }).limit(CHAT.history);
  if (error) throw dbError(error, 'chat.read');
  const blocked = await blockedBy(viewerId);
  const rows = data.filter((r) => !blocked.has(r.sender_id)).reverse();
  const people = await loadPlayers(rows.map((r) => r.sender_id));
  return rows.map((r) => format(r, people));
}

// ---------- sala general ----------
async function lobby(viewerId, after) {
  return { messages: await readChannel(viewerId, LOBBY, after) };
}

async function postLobby(playerId, raw) {
  const { sender, text } = await prepare(playerId, raw);
  return { message: await insertMessage(sender, LOBBY, text) };
}

// ---------- partida (lo llama el WebSocket) ----------
async function postMatch(playerId, code, raw) {
  const { sender, text } = await prepare(playerId, raw);
  return insertMessage(sender, matchChannel(code), text);
}

// ---------- privados ----------
async function otherPlayer(meId, otherId) {
  if (!isUuid(otherId) || otherId === meId) throw httpError(404, 'Jugador no encontrado');
  const { data, error } = await getDb().from('players').select('id, name, avatar, dm_open, google_sub').eq('id', otherId).maybeSingle();
  if (error) throw dbError(error, 'chat.other');
  if (!data || !data.google_sub) throw httpError(404, 'Jugador no encontrado');
  return data;
}

async function canWrite(meId, other) {
  if ((await blockedBy(meId)).has(other.id)) return { ok: false, reason: `Has bloqueado a ${other.name}. Desbloquéale para escribirle.` };
  if ((await blockedBy(other.id)).has(meId)) return { ok: false, reason: `${other.name} no acepta tus mensajes.` };
  if (other.dm_open === false) return { ok: false, reason: `${other.name} no acepta mensajes privados.` };
  return { ok: true };
}

const publicPlayer = (p) => ({ id: p.id, name: p.name, avatar: p.avatar && AVATARS[p.avatar] ? p.avatar : null });

async function thread(meId, otherId, after) {
  const other = await otherPlayer(meId, otherId);
  const channel = dmChannel(meId, other.id);
  let q = getDb().from('chat_messages').select('*').eq('channel', channel).eq('hidden', false);
  if (after && !Number.isNaN(Date.parse(after))) q = q.gte('created_at', new Date(Date.parse(after)).toISOString());
  const { data, error } = await q.order('created_at', { ascending: false }).limit(CHAT.history);
  if (error) throw dbError(error, 'chat.thread');
  const people = new Map([[other.id, publicPlayer(other)]]);
  const me = await loadPlayers([meId]);
  people.set(meId, me.get(meId));
  await getDb().rpc('mark_chat_read', { p_player: meId, p_channel: channel });
  const write = await canWrite(meId, other);
  return {
    with: publicPlayer(other),
    blocked: (await blockedBy(meId)).has(other.id),
    canWrite: write.ok,
    reason: write.reason || null,
    messages: data.reverse().map((r) => format(r, people)),
  };
}

async function postDm(meId, otherId, raw) {
  const other = await otherPlayer(meId, otherId);
  const write = await canWrite(meId, other);
  if (!write.ok) throw httpError(403, write.reason);
  const { sender, text } = await prepare(meId, raw);
  const message = await insertMessage(sender, dmChannel(meId, other.id), text, other.id);
  await getDb().rpc('mark_chat_read', { p_player: meId, p_channel: dmChannel(meId, other.id) });
  return { message };
}

// Lista de conversaciones con el último mensaje y si hay algo sin leer.
async function conversations(meId) {
  const db = getDb();
  const [sent, received, reads] = await Promise.all([
    db.from('chat_messages').select('*').eq('sender_id', meId).not('recipient_id', 'is', null).order('created_at', { ascending: false }).limit(300),
    db.from('chat_messages').select('*').eq('recipient_id', meId).eq('hidden', false).order('created_at', { ascending: false }).limit(300),
    db.from('chat_reads').select('channel, read_at').eq('player_id', meId),
  ]);
  for (const r of [sent, received, reads]) if (r.error) throw dbError(r.error, 'chat.conversations');
  const blocked = await blockedBy(meId);
  const readAt = new Map(reads.data.map((r) => [r.channel, Date.parse(iso(r.read_at))]));
  const byOther = new Map();
  for (const row of [...sent.data, ...received.data]) {
    const otherId = row.sender_id === meId ? row.recipient_id : row.sender_id;
    if (blocked.has(otherId)) continue;
    const c = byOther.get(otherId) || { otherId, last: null, unread: 0 };
    if (!c.last || Date.parse(iso(row.created_at)) > Date.parse(iso(c.last.created_at))) c.last = row;
    if (row.recipient_id === meId && Date.parse(iso(row.created_at)) > (readAt.get(row.channel) || 0)) c.unread += 1;
    byOther.set(otherId, c);
  }
  const people = await loadPlayers([...byOther.keys(), meId]);
  const list = [...byOther.values()]
    .sort((a, b) => Date.parse(iso(b.last.created_at)) - Date.parse(iso(a.last.created_at)))
    .slice(0, 50)
    .map((c) => ({
      with: people.get(c.otherId) || { id: c.otherId, name: '¿?', avatar: null },
      last: format(c.last, people),
      unread: c.unread,
    }));
  return { conversations: list, unread: list.reduce((s, c) => s + c.unread, 0) };
}

// ---------- reportar y bloquear ----------
async function report(meId, messageId, reason) {
  if (!isUuid(messageId)) throw httpError(404, 'Mensaje no encontrado');
  const why = CHAT.reasons.includes(reason) ? reason : 'otro';
  const { data: msg, error } = await getDb().from('chat_messages').select('*').eq('id', messageId).maybeSingle();
  if (error) throw dbError(error, 'chat.report.load');
  if (!msg || msg.sender_id === meId) throw httpError(404, 'Mensaje no encontrado');
  // Solo se puede reportar lo que uno puede ver: lo público o lo que le han enviado a él.
  if (msg.recipient_id && msg.recipient_id !== meId) throw httpError(404, 'Mensaje no encontrado');
  const { data, error: rErr } = await getDb().rpc('report_chat_message', {
    p_message: messageId,
    p_reporter: meId,
    p_reason: why,
    p_hide_at: CHAT.hideAt,
    p_mute_after: CHAT.muteAfter,
    p_mute_hours: CHAT.muteHours,
  });
  if (rErr) throw dbError(rErr, 'chat.report');
  return { ok: true, hidden: !!(data && data[0] && data[0].hidden) };
}

async function block(meId, otherId) {
  const other = await otherPlayer(meId, otherId);
  const { error } = await getDb().rpc('block_player', { p_blocker: meId, p_blocked: other.id });
  if (error) throw dbError(error, 'chat.block');
  (await blockedBy(meId)).add(other.id);
  return { ok: true, blocked: publicPlayer(other) };
}

async function unblock(meId, otherId) {
  if (!isUuid(otherId)) throw httpError(404, 'Jugador no encontrado');
  const { error } = await getDb().from('chat_blocks').delete().eq('blocker_id', meId).eq('blocked_id', otherId);
  if (error) throw dbError(error, 'chat.unblock');
  (await blockedBy(meId)).delete(otherId);
  return { ok: true };
}

async function settings(meId) {
  const row = await senderRow(meId);
  const blocked = await blockedBy(meId);
  const people = await loadPlayers([...blocked]);
  const until = row.chat_muted_until ? iso(row.chat_muted_until) : null;
  return {
    dmOpen: row.dm_open !== false,
    mutedUntil: until && Date.parse(until) > Date.now() ? until : null,
    blocked: [...blocked].map((id) => people.get(id)).filter(Boolean),
    maxLength: 200,
  };
}

async function setDmOpen(meId, open) {
  const { error } = await getDb().from('players').update({ dm_open: !!open }).eq('id', meId).select('id');
  if (error) throw dbError(error, 'chat.settings');
  return settings(meId);
}

// Buscar jugadores por nombre para escribirles.
async function search(meId, name) {
  const term = String(name || '').trim().slice(0, 20);
  if (term.length < 2) return { players: [] };
  const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { data, error } = await getDb().from('players').select('id, name, avatar, google_sub').ilike('name', pattern).limit(12);
  if (error) throw dbError(error, 'chat.search');
  return { players: data.filter((p) => p.google_sub && p.id !== meId).slice(0, 8).map(publicPlayer) };
}

// ---------- administración ----------
async function listReports() {
  const db = getDb();
  const { data: reports, error } = await db.from('chat_reports').select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(300);
  if (error) throw dbError(error, 'chat.admin.reports');
  const ids = [...new Set(reports.map((r) => r.message_id))];
  if (!ids.length) return { items: [] };
  const { data: msgs, error: mErr } = await db.from('chat_messages').select('*').in('id', ids);
  if (mErr) throw dbError(mErr, 'chat.admin.messages');
  const people = await loadPlayers(msgs.map((m) => m.sender_id));
  const items = msgs.map((m) => {
    const rs = reports.filter((r) => r.message_id === m.id);
    return {
      message: { ...format(m, people), channel: m.channel.startsWith('dm:') ? 'privado' : m.channel === LOBBY ? 'general' : 'partida', hidden: m.hidden },
      reports: rs.map((r) => ({ reason: r.reason, at: iso(r.created_at) })),
    };
  });
  items.sort((a, b) => b.reports.length - a.reports.length);
  return { items };
}

// action: 'dismiss' (falso aviso: se vuelve a mostrar), 'hide' (ocultar) o 'mute' (ocultar y silenciar 7 días).
async function resolveReport(messageId, action) {
  if (!isUuid(messageId)) throw httpError(404, 'Mensaje no encontrado');
  const db = getDb();
  const { data: msg, error } = await db.from('chat_messages').select('id, sender_id').eq('id', messageId).maybeSingle();
  if (error) throw dbError(error, 'chat.admin.load');
  if (!msg) throw httpError(404, 'Mensaje no encontrado');
  await db.from('chat_messages').update({ hidden: action !== 'dismiss' }).eq('id', messageId).select('id');
  if (action === 'mute') {
    await db.from('players').update({ chat_muted_until: new Date(Date.now() + 7 * 86_400_000).toISOString() }).eq('id', msg.sender_id).select('id');
  }
  await db.from('chat_reports').update({ resolved: true }).eq('message_id', messageId).select('message_id');
  return { ok: true };
}

async function prune() {
  const { error } = await getDb().rpc('prune_chat', { p_public_days: CHAT.keepPublicDays, p_private_days: CHAT.keepPrivateDays });
  if (error) console.error('[chat] prune', error.message);
}

// Para los tests.
function resetMemory() {
  recent.clear();
  blockCache.clear();
}

module.exports = {
  CHAT,
  lobby,
  postLobby,
  postMatch,
  thread,
  postDm,
  conversations,
  report,
  block,
  unblock,
  blockedBy,
  hides,
  settings,
  setDmOpen,
  search,
  listReports,
  resolveReport,
  prune,
  resetMemory,
};
