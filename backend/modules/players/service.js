const crypto = require('crypto');
const { getDb, dbError } = require('../../core/db');
const { httpError } = require('../../core/http');
const { validatePlayerName } = require('./names');
const { FREE_AVATARS, COINS, AVATARS } = require('../shop/catalog');

const PUBLIC_FIELDS =
  'id, name, rating, duels_played, duels_won, rooms_played, rooms_won, conquista_played, conquista_won, created_at, google_sub, coins, avatar';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function toPublic(row) {
  return {
    id: row.id,
    name: row.name,
    rating: row.rating,
    duelsPlayed: row.duels_played,
    duelsWon: row.duels_won,
    roomsPlayed: row.rooms_played,
    roomsWon: row.rooms_won,
    conquistaPlayed: row.conquista_played ?? 0,
    conquistaWon: row.conquista_won ?? 0,
    createdAt: row.created_at,
    hasAccount: !!row.google_sub,
    coins: row.coins ?? 0,
    avatar: row.avatar && AVATARS[row.avatar] ? row.avatar : null,
  };
}

const newToken = () => crypto.randomBytes(24).toString('base64url');

async function create(name) {
  const { value, error } = validatePlayerName(name);
  if (error) throw httpError(400, error);
  const token = newToken();
  const { data, error: dbErr } = await getDb()
    .from('players')
    .insert({ name: value, token_hash: hashToken(token) })
    .select(PUBLIC_FIELDS)
    .single();
  if (dbErr) throw dbError(dbErr, 'players.create');
  return { player: toPublic(data), token };
}

async function findById(id) {
  const { data, error } = await getDb().from('players').select(PUBLIC_FIELDS).eq('id', id).maybeSingle();
  if (error) throw dbError(error, 'players.findById');
  return data ? toPublic(data) : null;
}

// Devuelve el jugador de un token (sesión de Google o perfil de invitado antiguo), o null.
// Ojo: un perfil de invitado tiene hasAccount = false y ya no puede jugar hasta entrar con Google.
async function findByToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const hash = hashToken(token);
  const db = getDb();
  const { data: session, error: sErr } = await db.from('player_sessions').select('player_id').eq('token_hash', hash).maybeSingle();
  if (sErr) throw dbError(sErr, 'players.findByToken.session');
  if (session) return findById(session.player_id);
  const { data, error } = await db.from('players').select(PUBLIC_FIELDS).eq('token_hash', hash).maybeSingle();
  if (error) throw dbError(error, 'players.findByToken');
  return data ? toPublic(data) : null;
}

async function createSession(playerId) {
  const token = newToken();
  const { error: insErr } = await getDb().from('player_sessions').insert({ token_hash: hashToken(token), player_id: playerId });
  if (insErr) throw dbError(insErr, 'players.createSession');
  return token;
}

async function logout(token) {
  if (typeof token !== 'string') return;
  const { error } = await getDb().from('player_sessions').delete().eq('token_hash', hashToken(token));
  if (error) throw dbError(error, 'players.logout');
}

// Nombre inicial a partir del de Google; si no vale, uno genérico.
function nameFromGoogle(identity) {
  for (const candidate of [identity.givenName, identity.name]) {
    if (!candidate) continue;
    const { value } = validatePlayerName(String(candidate).slice(0, 20));
    if (value) return value;
  }
  return `Jugador${crypto.randomInt(1000, 10000)}`;
}

const randomFreeAvatar = () => FREE_AVATARS[crypto.randomInt(FREE_AVATARS.length)];

// Entrar con Google. Si es la primera vez y el navegador tenía un perfil de invitado,
// ese perfil se convierte en la cuenta (se conservan estadísticas y nombre).
// Devuelve { player, token, created }.
async function loginWithGoogle(identity, guestToken, { onCreated } = {}) {
  if (!identity || typeof identity.sub !== 'string' || !identity.sub) throw httpError(400, 'Identidad de Google no válida');
  const db = getDb();
  const { data: existing, error } = await db.from('players').select('id').eq('google_sub', identity.sub).maybeSingle();
  if (error) throw dbError(error, 'players.login.find');

  let playerId;
  let created = false;
  if (existing) {
    playerId = existing.id;
    await db.from('players').update({ email: identity.email || null, last_seen_at: new Date().toISOString() }).eq('id', playerId).select('id');
  } else {
    const guest = guestToken ? await findByToken(guestToken) : null;
    if (guest && !guest.hasAccount) {
      const { data: linked, error: linkErr } = await db
        .from('players')
        .update({ google_sub: identity.sub, email: identity.email || null, token_hash: null, coins: COINS.welcome, avatar: randomFreeAvatar() })
        .eq('id', guest.id)
        .is('google_sub', null)
        .select('id');
      if (linkErr) throw dbError(linkErr, 'players.login.link');
      if (linked.length) playerId = guest.id;
    }
    if (!playerId) {
      const { data: row, error: insErr } = await db
        .from('players')
        .insert({ name: nameFromGoogle(identity), google_sub: identity.sub, email: identity.email || null, coins: COINS.welcome, avatar: randomFreeAvatar() })
        .select('id')
        .single();
      if (insErr) throw dbError(insErr, 'players.login.create');
      playerId = row.id;
    }
    created = true;
    if (onCreated) await onCreated(playerId);
  }
  const token = await createSession(playerId);
  return { player: await findById(playerId), token, created };
}

async function rename(playerId, name) {
  const { value, error } = validatePlayerName(name);
  if (error) throw httpError(400, error);
  const { data, error: dbErr } = await getDb()
    .from('players')
    .update({ name: value })
    .eq('id', playerId)
    .select(PUBLIC_FIELDS)
    .single();
  if (dbErr) throw dbError(dbErr, 'players.rename');
  return toPublic(data);
}

async function profile(player) {
  const db = getDb();
  const [best, recent] = await Promise.all([
    db
      .from('blitz_sessions')
      .select('score')
      .eq('player_id', player.id)
      .order('score', { ascending: false })
      .limit(1),
    db
      .from('match_players')
      .select('match_id, score, position, correct_count, rating_before, rating_after')
      .eq('player_id', player.id)
      .limit(200),
  ]);
  if (best.error) throw dbError(best.error, 'players.profile.blitz');
  if (recent.error) throw dbError(recent.error, 'players.profile.matches');

  let matches = [];
  const ids = recent.data.map((r) => r.match_id);
  if (ids.length > 0) {
    const { data, error } = await db
      .from('matches')
      .select('id, mode, vs_bot, question_count, finished_at')
      .in('id', ids)
      .order('finished_at', { ascending: false })
      .limit(10);
    if (error) throw dbError(error, 'players.profile.matchInfo');
    const byId = new Map(recent.data.map((r) => [r.match_id, r]));
    matches = data.map((m) => {
      const mine = byId.get(m.id);
      return {
        mode: m.mode,
        vsBot: m.vs_bot,
        questionCount: m.question_count,
        finishedAt: m.finished_at,
        score: mine.score,
        position: mine.position,
        correctCount: mine.correct_count,
        ratingChange:
          mine.rating_before !== null && mine.rating_after !== null ? mine.rating_after - mine.rating_before : null,
      };
    });
  }

  return { ...player, bestBlitz: best.data[0]?.score ?? 0, recentMatches: matches };
}

async function conquistaLeaderboard(limit) {
  const { data, error } = await getDb()
    .from('players')
    .select('name, avatar, conquista_played, conquista_won')
    .gt('conquista_won', 0)
    .order('conquista_won', { ascending: false })
    .order('conquista_played', { ascending: true })
    .limit(limit);
  if (error) throw dbError(error, 'players.conquistaLeaderboard');
  return data.map((r, i) => ({ rank: i + 1, name: r.name, avatar: r.avatar || null, won: r.conquista_won, played: r.conquista_played }));
}

async function leaderboard(limit = 20, mode = 'duel') {
  limit = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 20));
  if (mode === 'conquista') return conquistaLeaderboard(limit);
  const { data, error } = await getDb()
    .from('players')
    .select('name, avatar, rating, duels_played, duels_won')
    .gt('duels_played', 0)
    .order('rating', { ascending: false })
    .order('duels_won', { ascending: false })
    .limit(limit);
  if (error) throw dbError(error, 'players.leaderboard');
  return data.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    avatar: r.avatar || null,
    rating: r.rating,
    duelsPlayed: r.duels_played,
    duelsWon: r.duels_won,
  }));
}

module.exports = { create, findByToken, findById, rename, profile, leaderboard, hashToken, loginWithGoogle, createSession, logout };
