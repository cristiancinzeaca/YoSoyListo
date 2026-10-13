// Campaña: progreso, escenas, combates (tus corazones contra la vida del enemigo) y recompensas.
const { getDb, dbError } = require('../../core/db');
const { httpError, isUuid } = require('../../core/http');
const { loadQuestions } = require('../multiplayer/persist');
const heroes = require('../heroes/service');
const { ITEMS } = require('../heroes/catalog');
const { CHAPTERS, SPEAKERS, BOSSES, REWARDS } = require('./story');

const HEARTS = 3;
const QUESTION_MS = 15_000;
const GRACE_MS = 1_500;
const FINAL_BOSS = 'c5f';

const NODE_INDEX = new Map();
for (const ch of CHAPTERS) ch.nodes.forEach((n, i) => NODE_INDEX.set(n.id, { chapter: ch, node: n, index: i }));

async function loadPlayer(playerId) {
  const { data, error } = await getDb().from('players').select('id, name, hero, campaign').eq('id', playerId).maybeSingle();
  if (error) throw dbError(error, 'campaign.player');
  if (!data) throw httpError(404, 'Jugador no encontrado');
  return data;
}

const doneSet = (p) => new Set(p.campaign && Array.isArray(p.campaign.done) ? p.campaign.done : []);
const chapterDone = (ch, done) => ch.nodes.every((n) => done.has(n.id));

// Qué capítulos están abiertos: primero el prólogo de tu raza; después los capítulos en orden
// (y los prólogos de las otras razas, como historias extra).
function chapterUnlocked(ch, player, done) {
  const race = player.hero && player.hero.race;
  if (!race) return false;
  const own = CHAPTERS.find((c) => c.race === race);
  if (ch === own) return true;
  if (!chapterDone(own, done)) return false;
  if (ch.race) return true;
  const main = CHAPTERS.filter((c) => !c.race);
  const i = main.indexOf(ch);
  return i === 0 || chapterDone(main[i - 1], done);
}

function nodeUnlocked(ref, player, done) {
  if (!chapterUnlocked(ref.chapter, player, done)) return false;
  return ref.index === 0 || done.has(ref.chapter.nodes[ref.index - 1].id);
}

function rewardFor(node, chapter) {
  if (node.type === 'battle') return { ...REWARDS.battle, items: [] };
  if (node.type !== 'boss') return { xp: 0, coins: 0, items: [] };
  const base = node.id === FINAL_BOSS ? REWARDS.finalBoss : REWARDS.boss;
  const items = [chapter.reward?.item, chapter.reward?.item2].filter(Boolean);
  return { ...base, items };
}

const publicReward = (r) => ({ xp: r.xp, coins: r.coins, items: r.items.map((id) => ({ id, name: ITEMS[id]?.name || id, slot: ITEMS[id]?.slot })) });

async function overview(playerId) {
  const player = await loadPlayer(playerId);
  const done = doneSet(player);
  const race = player.hero && player.hero.race;
  // Tu prólogo primero; los de otras razas, al final como extras.
  const ordered = [...CHAPTERS.filter((c) => c.race === race), ...CHAPTERS.filter((c) => !c.race), ...CHAPTERS.filter((c) => c.race && c.race !== race)];
  return {
    hasHero: !!race,
    hearts: HEARTS,
    speakers: SPEAKERS,
    chapters: ordered.map((ch) => ({
      id: ch.id,
      title: ch.title,
      place: ch.place,
      img: ch.img,
      extra: !!(ch.race && ch.race !== race),
      unlocked: chapterUnlocked(ch, player, done),
      done: chapterDone(ch, done),
      reward: publicReward(rewardFor(ch.nodes.find((n) => n.type === 'boss'), ch)),
      nodes: ch.nodes.map((n, i) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        lines: n.lines || null,
        hp: n.hp || null,
        enemy: n.enemy || null,
        done: done.has(n.id),
        unlocked: nodeUnlocked({ chapter: ch, node: n, index: i }, player, done),
        reward: n.type === 'story' ? null : publicReward(rewardFor(n, ch)),
      })),
    })),
  };
}

function refOf(nodeId) {
  const ref = NODE_INDEX.get(String(nodeId || ''));
  if (!ref) throw httpError(404, 'Esa parte de la historia no existe');
  return ref;
}

async function complete(playerId, ref) {
  const reward = rewardFor(ref.node, ref.chapter);
  const { data, error } = await getDb().rpc('campaign_complete', { p_id: playerId, p_node: ref.node.id, p_items: reward.items });
  if (error) throw dbError(error, 'campaign.complete');
  const first = !!(data && data[0] && data[0].first_time);
  if (!first) return { first: false };
  let coins = null;
  if (reward.coins) {
    const { data: c, error: cErr } = await getDb().rpc('add_coins', { p_id: playerId, p_amount: reward.coins, p_reason: `campaign:${ref.node.id}` });
    if (cErr) console.error('[campaña] monedas', cErr.message);
    coins = c && c[0] ? c[0].balance : null;
  }
  const xp = reward.xp ? await heroes.safeXp(playerId, reward.xp, `campaign:${ref.node.id}`) : null;
  return { first: true, reward: publicReward(reward), xp, balance: coins };
}

// Escena leída.
async function read(playerId, nodeId) {
  const ref = refOf(nodeId);
  if (ref.node.type !== 'story') throw httpError(400, 'Esto no es una escena');
  const player = await loadPlayer(playerId);
  const done = doneSet(player);
  if (!nodeUnlocked(ref, player, done)) throw httpError(403, 'Todavía no has llegado aquí');
  await complete(playerId, ref);
  return { ok: true, chapterDone: chapterDone(ref.chapter, new Set([...done, ref.node.id])) };
}

function questionOut(run, i) {
  const q = run.questions.list[i];
  return { index: i, text: q.text, options: q.options, category: q.category, ms: QUESTION_MS };
}

// Empieza un combate o un jefe.
async function start(playerId, nodeId) {
  const ref = refOf(nodeId);
  if (ref.node.type === 'story') throw httpError(400, 'Esto es una escena, no un combate');
  const player = await loadPlayer(playerId);
  if (!nodeUnlocked(ref, player, doneSet(player))) throw httpError(403, 'Todavía no has llegado aquí');
  // Preguntas suficientes para ganar aunque falles todas las vidas menos una.
  const need = ref.node.hp + HEARTS;
  const list = (await loadQuestions(need, ref.chapter.category)).map((q) => ({
    id: q.id,
    text: q.text,
    options: q.options,
    correctIndex: q.correctIndex,
    category: q.category,
    explanation: q.explanation || null,
  }));
  if (list.length < need) throw httpError(503, 'No hay preguntas suficientes para este combate');
  const { data: run, error } = await getDb()
    .from('campaign_runs')
    .insert({
      player_id: playerId,
      node: ref.node.id,
      questions: { list },
      hearts: HEARTS,
      enemy_hp: ref.node.hp,
      deadline: new Date(Date.now() + QUESTION_MS + GRACE_MS).toISOString(),
    })
    .select('*')
    .single();
  if (error) throw dbError(error, 'campaign.start');
  return { runId: run.id, hearts: HEARTS, enemyHp: ref.node.hp, enemyMax: ref.node.hp, enemy: ref.node.enemy, question: questionOut(run, 0) };
}

async function answer(playerId, runId, { index, option } = {}) {
  if (!isUuid(runId)) throw httpError(404, 'Combate no encontrado');
  const { data: run, error } = await getDb().from('campaign_runs').select('*').eq('id', runId).maybeSingle();
  if (error) throw dbError(error, 'campaign.answer.load');
  if (!run || run.player_id !== playerId) throw httpError(404, 'Combate no encontrado');
  if (run.status !== 'active') throw httpError(409, 'Este combate ya ha terminado');
  if (Number(index) !== run.current) throw httpError(409, 'Esa pregunta ya está respondida');
  const q = run.questions.list[run.current];
  const late = Date.now() > Date.parse(run.deadline instanceof Date ? run.deadline.toISOString() : run.deadline);
  const right = !late && Number(option) === q.correctIndex;
  const hearts = right ? run.hearts : run.hearts - 1;
  const enemyHp = right ? run.enemy_hp - 1 : run.enemy_hp;
  const status = enemyHp <= 0 ? 'won' : hearts <= 0 ? 'lost' : 'active';
  const next = run.current + 1;
  const { data: saved, error: uErr } = await getDb()
    .from('campaign_runs')
    .update({
      current: next,
      hearts,
      enemy_hp: enemyHp,
      status,
      deadline: new Date(Date.now() + QUESTION_MS + GRACE_MS).toISOString(),
    })
    .eq('id', run.id)
    .eq('current', run.current)
    .eq('status', 'active')
    .select('id');
  if (uErr) throw dbError(uErr, 'campaign.answer.save');
  if (!saved.length) throw httpError(409, 'Respuesta duplicada');

  const out = { right, late, correctIndex: q.correctIndex, explanation: q.explanation, hearts, enemyHp, status };
  if (status === 'won') {
    const ref = refOf(run.node);
    Object.assign(out, await complete(playerId, ref));
  } else if (status === 'active') {
    out.question = questionOut(run, next);
  }
  return out;
}

module.exports = { overview, read, start, answer, HEARTS, chapterUnlocked, CHAPTERS, BOSSES };
