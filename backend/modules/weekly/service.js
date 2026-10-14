// Liga semanal: cada punto de experiencia ganado de lunes a domingo (hora de Madrid) cuenta.
// Al empezar la semana siguiente, los 10 primeros reciben monedas (una sola vez).
const { getDb, dbError } = require('../../core/db');

const PRIZES = [1000, 600, 400, 150, 150, 150, 150, 150, 150, 150];
const DAY = 86_400_000;

// Fecha y hora de Madrid como si fueran UTC (para hacer cuentas de días sin líos de zona horaria).
function madridNow(now = Date.now()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(now))
      .map((p) => [p.type, p.value])
  );
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
}

// Semana = el lunes en que empieza ('YYYY-MM-DD').
function weekOf(now = Date.now()) {
  const local = madridNow(now);
  const midnight = local - (local % DAY);
  const dow = (new Date(midnight).getUTCDay() + 6) % 7; // lunes = 0
  const monday = midnight - dow * DAY;
  return { week: new Date(monday).toISOString().slice(0, 10), endsInMs: monday + 7 * DAY - local };
}

const previousWeek = (week) => new Date(Date.parse(`${week}T00:00:00Z`) - 7 * DAY).toISOString().slice(0, 10);

async function addPoints(playerId, amount) {
  const points = Math.max(0, Math.round(amount || 0));
  if (!points) return;
  const { error } = await getDb().rpc('add_week_points', { p_id: playerId, p_week: weekOf().week, p_amount: points });
  if (error) throw dbError(error, 'weekly.add');
}

// Sin que un fallo de la liga rompa el final de una partida.
async function safeAdd(playerId, amount) {
  try {
    await addPoints(playerId, amount);
  } catch (err) {
    console.error('[liga] no se pudieron sumar puntos', err.message);
  }
}

async function leaderboard(week, limit = 20) {
  const db = getDb();
  const { data, error } = await db
    .from('weekly_points')
    .select('player_id, points, updated_at')
    .eq('week', week)
    .gt('points', 0)
    .order('points', { ascending: false })
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (error) throw dbError(error, 'weekly.board');
  if (!data.length) return [];
  const { data: people, error: pErr } = await db.from('players').select('id, name, avatar, hero').in('id', data.map((r) => r.player_id));
  if (pErr) throw dbError(pErr, 'weekly.board.players');
  const byId = new Map(people.map((p) => [p.id, p]));
  return data.map((r, i) => {
    const p = byId.get(r.player_id) || {};
    return { rank: i + 1, playerId: r.player_id, name: p.name || '¿?', avatar: p.avatar || null, points: r.points, prize: PRIZES[i] || 0 };
  });
}

async function myStanding(week, playerId) {
  const db = getDb();
  const { data, error } = await db.from('weekly_points').select('points').eq('week', week).eq('player_id', playerId).maybeSingle();
  if (error) throw dbError(error, 'weekly.me');
  const points = data ? data.points : 0;
  if (!points) return { points: 0, rank: null };
  const { count, error: cErr } = await db.from('weekly_points').select('player_id', { count: 'exact', head: true }).eq('week', week).gt('points', points);
  if (cErr) throw dbError(cErr, 'weekly.rank');
  return { points, rank: (count || 0) + 1 };
}

async function unseenPrizes(playerId) {
  const { data, error } = await getDb().from('weekly_prizes').select('week, rank, coins').eq('player_id', playerId).eq('seen', false);
  if (error) throw dbError(error, 'weekly.prizes');
  return data || [];
}

async function state(playerId) {
  const { week, endsInMs } = weekOf();
  const [board, me, prizes] = await Promise.all([
    leaderboard(week),
    playerId ? myStanding(week, playerId) : null,
    playerId ? unseenPrizes(playerId) : [],
  ]);
  return { week, endsInMs, prizes: PRIZES, leaderboard: board, me, won: prizes };
}

async function markSeen(playerId) {
  const { error } = await getDb().from('weekly_prizes').update({ seen: true }).eq('player_id', playerId).eq('seen', false);
  if (error) throw dbError(error, 'weekly.seen');
  return { ok: true };
}

// Reparte los premios de la semana pasada (la base de datos garantiza que solo se haga una vez).
async function settle(now = Date.now()) {
  const week = previousWeek(weekOf(now).week);
  const { data, error } = await getDb().rpc('pay_weekly_prizes', { p_week: week, p_prizes: PRIZES });
  if (error) throw dbError(error, 'weekly.settle');
  const paid = Array.isArray(data) ? data[0]?.paid ?? data[0] : data;
  if (paid) console.log(`[liga] premios de la semana ${week} repartidos a ${paid} jugadores`);
  return { week, paid: paid || 0 };
}

module.exports = { PRIZES, weekOf, previousWeek, addPoints, safeAdd, leaderboard, state, markSeen, settle };
