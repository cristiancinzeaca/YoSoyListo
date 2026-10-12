const crypto = require('crypto');
const { getDb, dbError } = require('../../core/db');
const { httpError } = require('../../core/http');
const { validatePlayerName } = require('./names');

const PUBLIC_FIELDS =
  'id, name, rating, duels_played, duels_won, rooms_played, rooms_won, conquista_played, conquista_won, created_at';

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
  };
}

async function create(name) {
  const { value, error } = validatePlayerName(name);
  if (error) throw httpError(400, error);
  const token = crypto.randomBytes(24).toString('base64url');
  const { data, error: dbErr } = await getDb()
    .from('players')
    .insert({ name: value, token_hash: hashToken(token) })
    .select(PUBLIC_FIELDS)
    .single();
  if (dbErr) throw dbError(dbErr, 'players.create');
  return { player: toPublic(data), token };
}

// Devuelve el jugador de un token, o null si el token no es válido.
async function findByToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const { data, error } = await getDb()
    .from('players')
    .select(PUBLIC_FIELDS)
    .eq('token_hash', hashToken(token))
    .maybeSingle();
  if (error) throw dbError(error, 'players.findByToken');
  return data ? toPublic(data) : null;
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
    .select('name, conquista_played, conquista_won')
    .gt('conquista_won', 0)
    .order('conquista_won', { ascending: false })
    .order('conquista_played', { ascending: true })
    .limit(limit);
  if (error) throw dbError(error, 'players.conquistaLeaderboard');
  return data.map((r, i) => ({ rank: i + 1, name: r.name, won: r.conquista_won, played: r.conquista_played }));
}

async function leaderboard(limit = 20, mode = 'duel') {
  limit = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 20));
  if (mode === 'conquista') return conquistaLeaderboard(limit);
  const { data, error } = await getDb()
    .from('players')
    .select('name, rating, duels_played, duels_won')
    .gt('duels_played', 0)
    .order('rating', { ascending: false })
    .order('duels_won', { ascending: false })
    .limit(limit);
  if (error) throw dbError(error, 'players.leaderboard');
  return data.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    rating: r.rating,
    duelsPlayed: r.duels_played,
    duelsWon: r.duels_won,
  }));
}

module.exports = { create, findByToken, rename, profile, leaderboard, hashToken };
