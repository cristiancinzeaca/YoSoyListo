const { getDb, dbError } = require('../../core/db');
const { eloUpdate } = require('./elo');
const shop = require('../shop/service');
const { matchCoins } = require('../shop/rewards');
const heroes = require('../heroes/service');
const { matchXp } = require('../heroes/rewards');

// Reparte las monedas de la partida y las anota en cada fila de la clasificación.
async function awardMatchCoins(mode, ranking) {
  await Promise.all(
    ranking
      .filter((r) => !r.isBot)
      .map(async (r) => {
        try {
          const res = await shop.award(r.playerId, matchCoins(mode, r, ranking), `game:${mode}`);
          r.coins = res.awarded + res.bonus;
          r.coinsBonus = res.bonus;
        } catch (err) {
          console.error('[coins] no se pudieron dar las monedas', err.context || '', err.cause || err);
        }
        // Experiencia (y subida de nivel, si toca).
        const xp = await heroes.safeXp(r.playerId, matchXp(mode, r, ranking), `game:${mode}`);
        if (xp) r.xp = xp;
      })
  );
}

// Carga preguntas completas (con la respuesta correcta) para una partida en red.
async function loadQuestions(count, category) {
  const { data, error } = await getDb().rpc('random_questions', { p_limit: count, p_category: category || null });
  if (error) throw dbError(error, 'multiplayer.loadQuestions');
  return data.map((q) => ({
    id: q.id,
    text: q.text,
    options: q.options,
    correctIndex: q.correct_index,
    category: q.category,
    explanation: q.explanation,
  }));
}

// Guarda el resultado, actualiza estadísticas y ELO. Devuelve la clasificación
// con los cambios de puntuación ELO (solo en duelos entre dos personas).
async function saveMatch(room, ranking) {
  const db = getDb();
  const humans = ranking.filter((r) => !r.isBot);
  if (humans.length === 0) return ranking;
  const vsBot = ranking.some((r) => r.isBot);

  // Los retos entre amigos no cambian el ELO (para que no se pueda «regalar» puntos).
  if (room.mode === 'duel' && !room.friendly && !vsBot && humans.length === 2) {
    const { data, error } = await db.from('players').select('id, rating').in('id', humans.map((h) => h.playerId));
    if (error) throw dbError(error, 'multiplayer.saveMatch.ratings');
    const ratingOf = new Map(data.map((p) => [p.id, p.rating]));
    const [a, b] = humans;
    const before = [ratingOf.get(a.playerId) ?? 1000, ratingOf.get(b.playerId) ?? 1000];
    const result = a.position === b.position ? 0.5 : a.position < b.position ? 1 : 0;
    const after = eloUpdate(before[0], before[1], result);
    [a, b].forEach((h, i) => {
      h.ratingBefore = before[i];
      h.ratingAfter = after[i];
    });
  }

  const { data: match, error: matchErr } = await db
    .from('matches')
    .insert({
      mode: room.mode,
      category: room.category,
      question_count: room.questions.length,
      vs_bot: vsBot,
      started_at: (room.startedAt || new Date()).toISOString(),
    })
    .select('id')
    .single();
  if (matchErr) throw dbError(matchErr, 'multiplayer.saveMatch.match');

  const { error: mpErr } = await db.from('match_players').insert(
    ranking.map((r) => ({
      match_id: match.id,
      player_id: r.isBot ? null : r.playerId,
      name: r.name,
      is_bot: r.isBot,
      score: r.score,
      correct_count: r.correctCount,
      position: r.position,
      rating_before: r.ratingBefore,
      rating_after: r.ratingAfter,
    }))
  );
  if (mpErr) throw dbError(mpErr, 'multiplayer.saveMatch.players');

  const rankedDuel = room.mode === 'duel' && !vsBot;
  const winners = ranking.filter((r) => r.position === 1);
  const soleWinner = winners.length === 1 ? winners[0].playerId : null;
  await Promise.all(
    humans.map(async (h) => {
      const { error } = await db.rpc('apply_player_result', {
        p_id: h.playerId,
        p_rating: h.ratingAfter,
        p_duels: rankedDuel ? 1 : 0,
        p_duel_wins: rankedDuel && h.playerId === soleWinner ? 1 : 0,
        p_rooms: room.mode === 'room' ? 1 : 0,
        p_room_wins: room.mode === 'room' && h.playerId === soleWinner ? 1 : 0,
      });
      if (error) throw dbError(error, 'multiplayer.saveMatch.stats');
    })
  );

  await awardMatchCoins(room.mode, ranking);
  return ranking;
}

module.exports = { loadQuestions, saveMatch, awardMatchCoins };
