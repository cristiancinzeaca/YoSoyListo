// Pruebas contra un PostgreSQL de verdad. Solo se ejecutan si existe TEST_DATABASE_URL
// (por ejemplo: TEST_DATABASE_URL=postgres://postgres@localhost/ysl_test npm test).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPgDb } = require('../core/pgdb');
const { migrate } = require('../core/migrate');

const url = process.env.TEST_DATABASE_URL;

test('adaptador PostgreSQL', { skip: !url && 'sin TEST_DATABASE_URL' }, async (t) => {
  const db = createPgDb(url);
  t.after(() => db.pool.end());

  const total = await migrate(db.pool);
  assert.ok(total >= 400, `preguntas cargadas: ${total}`);
  assert.equal(await migrate(db.pool), total, 'migrar dos veces no duplica');

  const cats = await db.rpc('question_categories');
  assert.equal(cats.error, null);
  assert.ok(cats.data.length >= 6);

  const rnd = await db.rpc('random_questions', { p_limit: 5, p_category: 'ciencia' });
  assert.equal(rnd.data.length, 5);
  assert.ok(rnd.data.every((q) => q.category === 'ciencia' && Array.isArray(q.options)));

  const page = await db
    .from('questions')
    .select('*', { count: 'exact' })
    .ilike('text', '%capital%')
    .order('created_at', { ascending: false })
    .range(0, 4);
  assert.equal(page.error, null);
  assert.equal(page.data.length, 5);
  assert.ok(page.count > 5);

  const ins = await db
    .from('players')
    .insert({ name: 'Prueba', token_hash: `h${Date.now()}` })
    .select('id, name, rating, created_at')
    .single();
  assert.equal(ins.error, null);
  assert.equal(ins.data.rating, 1000);
  assert.match(ins.data.created_at, /^\d{4}-\d\d-\d\dT.*Z$/);

  const ids = rnd.data.map((q) => q.id);
  const sess = await db
    .from('blitz_sessions')
    .insert({ question_ids: ids, player_id: ins.data.id, ends_at: new Date(Date.now() + 60000).toISOString() })
    .select('*')
    .single();
  assert.equal(sess.error, null);
  assert.deepEqual(sess.data.answers, {});

  const upd = await db
    .from('blitz_sessions')
    .update({ answers: { [ids[0]]: 2 }, score: 10, answered_count: 1 })
    .eq('id', sess.data.id)
    .eq('answered_count', 0)
    .is('finished_at', null)
    .select('id');
  assert.equal(upd.data.length, 1);
  const again = await db
    .from('blitz_sessions')
    .update({ score: 99 })
    .eq('id', sess.data.id)
    .eq('answered_count', 0)
    .select('id');
  assert.equal(again.data.length, 0, 'bloqueo optimista');

  const got = await db.from('blitz_sessions').select('answers, score').eq('id', sess.data.id).maybeSingle();
  assert.equal(got.data.answers[ids[0]], 2);

  const cnt = await db
    .from('blitz_sessions')
    .select('id', { count: 'exact', head: true })
    .not('player_name', 'is', null)
    .gt('score', 5);
  assert.equal(typeof cnt.count, 'number');

  const r = await db.rpc('apply_player_result', {
    p_id: ins.data.id,
    p_rating: 1016,
    p_duels: 1,
    p_duel_wins: 1,
    p_rooms: 0,
    p_room_wins: 0,
  });
  assert.equal(r.error, null);
  const p = await db.from('players').select('rating, duels_won').in('id', [ins.data.id]);
  assert.deepEqual(p.data[0], { rating: 1016, duels_won: 1 });

  const none = await db.from('questions').select('id').eq('id', '00000000-0000-4000-8000-000000000000').maybeSingle();
  assert.equal(none.data, null);
  const bad = await db.from('questions').select('id').eq('id', 'no-uuid').maybeSingle();
  assert.ok(bad.error, 'los errores se devuelven, no se lanzan');

  await db.from('blitz_sessions').delete().eq('id', sess.data.id);
  const del = await db.from('players').delete().eq('id', ins.data.id).select('id');
  assert.equal(del.data.length, 1);
});
