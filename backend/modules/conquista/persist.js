const { getDb, dbError } = require('../../core/db');
const { loadQuestions } = require('../multiplayer/persist');

async function loadNumeric(count) {
  const { data, error } = await getDb().rpc('random_numeric_questions', { p_limit: count });
  if (error) throw dbError(error, 'conquista.loadNumeric');
  return data.map((q) => ({ id: q.id, text: q.text, answer: Number(q.answer), unit: q.unit, category: q.category }));
}

function loadChoice(count) {
  return loadQuestions(count, null);
}

async function saveConquista(game, ranking) {
  const db = getDb();
  const humans = ranking.filter((r) => !r.isBot);
  if (humans.length === 0) return ranking;

  const { data: match, error } = await db
    .from('matches')
    .insert({
      mode: 'conquista',
      category: null,
      question_count: 0,
      vs_bot: ranking.some((r) => r.isBot),
      started_at: game.startedAt.toISOString(),
    })
    .select('id')
    .single();
  if (error) throw dbError(error, 'conquista.save.match');

  const { error: mpErr } = await db.from('match_players').insert(
    ranking.map((r) => ({
      match_id: match.id,
      player_id: r.isBot ? null : r.playerId,
      name: r.name,
      is_bot: r.isBot,
      score: r.score,
      correct_count: r.regions,
      position: r.position,
      rating_before: null,
      rating_after: null,
    }))
  );
  if (mpErr) throw dbError(mpErr, 'conquista.save.players');

  const winners = ranking.filter((r) => r.position === 1);
  await Promise.all(
    humans.map(async (h) => {
      const won = winners.length === 1 && winners[0].playerId === h.playerId ? 1 : 0;
      const { error: e } = await db.rpc('apply_conquista_result', { p_id: h.playerId, p_won: won });
      if (e) throw dbError(e, 'conquista.save.stats');
    })
  );
  return ranking;
}

module.exports = { loadNumeric, loadChoice, saveConquista };
