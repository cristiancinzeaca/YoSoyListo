const crypto = require('crypto');
const { getDb, dbError } = require('../../core/db');
const { httpError } = require('../../core/http');
const { validatePlayerName, nameKey, numberedName } = require('./names');
const { FREE_AVATARS, COINS, AVATARS } = require('../shop/catalog');
const heroes = require('../heroes/service');
const age = require('./age');
const mm = require('../multiplayer/matchmaking');

const PUBLIC_FIELDS =
  'id, name, rating, duels_played, duels_won, rooms_played, rooms_won, conquista_played, conquista_won, created_at, google_sub, password_hash, email_verified, coins, avatar, xp, hero, campaign, birthdate, birthday_gift_year, free_rename_used';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function toPublic(row) {
  const hero = heroes.summary(row);
  return {
    // Rango de emparejamiento (ELO + experiencia).
    tier: mm.tierOf(mm.matchRating({ rating: row.rating, level: hero.level })),
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
    hasAccount: !!(row.google_sub || row.password_hash),
    coins: row.coins ?? 0,
    avatar: row.avatar && AVATARS[row.avatar] ? row.avatar : null,
    // Héroe, nivel y poder (lo que ven los rivales).
    ...heroes.summary(row),
    // La fecha no sale nunca del servidor: solo si ya la puso y si es mayor de edad.
    birthdateSet: !!row.birthdate,
    freeRename: !row.free_rename_used,
    adult: row.birthdate ? age.ageOn(row.birthdate) >= age.ADULT_AGE : false,
  };
}

const newToken = () => crypto.randomBytes(24).toString('base64url');

async function findById(id) {
  const { data, error } = await getDb().from('players').select(PUBLIC_FIELDS).eq('id', id).maybeSingle();
  if (error) throw dbError(error, 'players.findById');
  return data ? toPublic(data) : null;
}

// Devuelve el jugador de un token (sesión de Google o perfil de invitado antiguo), o null.
// Ojo: un perfil de invitado tiene hasAccount = false y ya no puede jugar hasta entrar con Google.
// «Visto por última vez» (para el panel de administración): como mucho una escritura cada 10 minutos por jugador.
const lastTouch = new Map();
function touch(player) {
  if (!player || !player.id) return;
  const now = Date.now();
  if (now - (lastTouch.get(player.id) || 0) < 10 * 60_000) return;
  lastTouch.set(player.id, now);
  if (lastTouch.size > 50_000) lastTouch.clear();
  getDb()
    .from('players')
    .update({ last_seen_at: new Date(now).toISOString() })
    .eq('id', player.id)
    .select('id')
    .then(({ error }) => error && console.error('[players] last_seen', error.message))
    .catch(() => {});
}

async function findByToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const hash = hashToken(token);
  const db = getDb();
  const { data: session, error: sErr } = await db.from('player_sessions').select('player_id').eq('token_hash', hash).maybeSingle();
  if (sErr) throw dbError(sErr, 'players.findByToken.session');
  let player = null;
  if (session) player = await findById(session.player_id);
  else {
    const { data, error } = await db.from('players').select(PUBLIC_FIELDS).eq('token_hash', hash).maybeSingle();
    if (error) throw dbError(error, 'players.findByToken');
    player = data ? toPublic(data) : null;
  }
  touch(player);
  return player;
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

// ¿Está libre este nombre? (ignora mayúsculas, acentos y separadores)
async function nameTaken(name, exceptId = null) {
  let q = getDb().from('players').select('id').eq('name_key', nameKey(name)).limit(1);
  if (exceptId) q = q.neq('id', exceptId);
  const { data, error } = await q;
  if (error) throw dbError(error, 'players.nameTaken');
  return data.length > 0;
}

// Primer nombre libre: «Ana», «Ana2», «Ana3»… y, si todo está cogido, con un número al azar.
async function freeName(name) {
  for (let n = 1; n <= 30; n++) {
    const candidate = n === 1 ? name : numberedName(name, n);
    if (!(await nameTaken(candidate))) return candidate;
  }
  return numberedName(name, crypto.randomInt(100, 100000));
}

// Para el formulario del perfil: ¿se puede usar y cuánto cuesta?
async function checkName(name, player) {
  const { value, error } = validatePlayerName(name);
  if (error) return { available: false, error };
  if (await nameTaken(value, player.id)) return { available: false, error: 'Ese nombre ya lo tiene otro jugador' };
  const cost = nameKey(value) === nameKey(player.name) || player.freeRename ? 0 : COINS.rename;
  return { available: true, name: value, cost, firstFree: cost === 0 && player.freeRename && nameKey(value) !== nameKey(player.name) };
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
    if (identity.email) {
      const { data: byMail } = await db
        .from('players')
        .select('id')
        .eq('email', String(identity.email).trim().toLowerCase())
        .is('google_sub', null)
        .not('password_hash', 'is', null)
        .limit(1);
      if (byMail && byMail.length) {
        await db.from('players').update({ google_sub: identity.sub, email_verified: true }).eq('id', byMail[0].id).select('id');
        const token = await createSession(byMail[0].id);
        return { player: await findById(byMail[0].id), token, created: false };
      }
    }
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
      // Dos altas a la vez con el mismo nombre: el índice único rechaza una y se reintenta.
      const wanted = nameFromGoogle(identity);
      for (let attempt = 0; !playerId; attempt++) {
        const name = attempt < 3 ? await freeName(wanted) : numberedName(wanted, crypto.randomInt(100, 100000));
        const { data: row, error: insErr } = await db
          .from('players')
          .insert({ name, name_key: nameKey(name), google_sub: identity.sub, email: identity.email || null, coins: COINS.welcome, avatar: randomFreeAvatar() })
          .select('id')
          .single();
        if (insErr && insErr.code === '23505' && String(insErr.constraint || insErr.message).includes('name_key') && attempt < 5) continue;
        if (insErr) throw dbError(insErr, 'players.login.create');
        playerId = row.id;
      }
    }
    created = true;
    if (onCreated) await onCreated(playerId);
  }
  const token = await createSession(playerId);
  return { player: await findById(playerId), token, created };
}

// Fecha de nacimiento: obligatoria, se pone una sola vez. Menores de 14 años no pueden tener cuenta.
async function setBirthdate(playerId, text) {
  const parsed = age.parseDate(text);
  if (!parsed) throw httpError(400, 'Fecha no válida');
  const years = age.ageOn(text);
  if (years === null || years < 0 || years > 120) throw httpError(400, 'Fecha no válida');
  const db = getDb();
  const { data: row, error } = await db.from('players').select('id, birthdate').eq('id', playerId).maybeSingle();
  if (error) throw dbError(error, 'players.birthdate.load');
  if (!row) throw httpError(404, 'Jugador no encontrado');
  if (row.birthdate) throw httpError(409, 'Tu fecha de nacimiento ya está guardada. Si es un error, escríbenos.');
  if (years < age.MIN_AGE) {
    // No se guardan datos de menores de 14: se borra la cuenta.
    const { error: delErr } = await db.from('players').delete().eq('id', playerId);
    if (delErr) throw dbError(delErr, 'players.birthdate.minor');
    throw httpError(403, `Lo sentimos: para tener cuenta en Yo Soy Listo hay que tener al menos ${age.MIN_AGE} años.`);
  }
  const { error: upErr } = await db.from('players').update({ birthdate: text }).eq('id', playerId).is('birthdate', null).select('id');
  if (upErr) throw dbError(upErr, 'players.birthdate.save');
  return { ...(await findById(playerId)), ...(await birthdayGift(playerId)) };
}

// Si hoy es su cumpleaños y aún no ha recibido el regalo de este año, se lo da.
async function birthdayGift(playerId) {
  const { data: row, error } = await getDb().from('players').select('birthdate, birthday_gift_year').eq('id', playerId).maybeSingle();
  if (error || !row || !row.birthdate || !age.isBirthday(row.birthdate)) return {};
  const year = Number(age.today().slice(0, 4));
  if (row.birthday_gift_year >= year) return {};
  const { data, error: gErr } = await getDb().rpc('birthday_gift', { p_id: playerId, p_year: year, p_amount: age.BIRTHDAY_GIFT });
  if (gErr) {
    console.error('[cumpleaños]', gErr.message);
    return {};
  }
  return data && data[0] ? { birthdayGift: age.BIRTHDAY_GIFT, coins: data[0].balance } : {};
}

// Cuenta nueva con correo y contraseña (el nombre se elige libre a partir del deseado).
async function createLocal({ email, wantedName, passwordHash, verified }) {
  const db = getDb();
  let fallback = wantedName;
  if (!validatePlayerName(fallback).value) fallback = `Jugador${crypto.randomInt(1000, 10000)}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const name = attempt < 3 ? await freeName(fallback) : numberedName(fallback, crypto.randomInt(100, 100000));
    const { data, error } = await db
      .from('players')
      .insert({
        name,
        name_key: nameKey(name),
        email,
        password_hash: passwordHash,
        email_verified: !!verified,
        coins: COINS.welcome,
        avatar: randomFreeAvatar(),
      })
      .select('id')
      .single();
    if (error && error.code === '23505' && String(error.constraint || error.message).includes('name_key')) continue;
    if (error && error.code === '23505') throw httpError(409, 'Ya hay una cuenta con ese correo');
    if (error) throw dbError(error, 'players.createLocal');
    return data.id;
  }
  throw httpError(500, 'No se pudo crear la cuenta');
}

// Cambiar de nombre: cuesta COINS.rename (gratis si solo cambian mayúsculas o acentos).
async function rename(playerId, name) {
  const { value, error } = validatePlayerName(name);
  if (error) throw httpError(400, error);
  const { data, error: dbErr } = await getDb().rpc('rename_player', {
    p_id: playerId,
    p_name: value,
    p_key: nameKey(value),
    p_cost: COINS.rename,
  });
  if (dbErr) throw dbError(dbErr, 'players.rename');
  const r = data && data[0];
  if (!r) throw httpError(404, 'Jugador no encontrado');
  if (r.reason === 'taken') throw httpError(409, 'Ese nombre ya lo tiene otro jugador');
  if (r.reason === 'coins') throw httpError(409, `Cambiar de nombre cuesta ${COINS.rename} monedas y no tienes suficientes`);
  return { ...(await findById(playerId)), cost: r.cost };
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

  // Regalo de cumpleaños (si toca hoy).
  const gift = await birthdayGift(player.id);
  return { ...player, ...gift, bestBlitz: best.data[0]?.score ?? 0, recentMatches: matches };
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

module.exports = { createLocal, setBirthdate, birthdayGift, checkName, findByToken, findById, rename, profile, leaderboard, hashToken, loginWithGoogle, createSession, logout };
