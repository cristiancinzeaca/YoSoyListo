const { getDb, dbError } = require('../../core/db');
const { httpError } = require('../../core/http');
const { validateQuestion, normalizeCategory, toDb, fromDb } = require('./validate');

const BULK_MAX = 500;

async function list({ page = 1, pageSize = 20, search, category } = {}) {
  page = Math.max(1, Number.parseInt(page, 10) || 1);
  pageSize = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 20));
  const from = (page - 1) * pageSize;

  let query = getDb()
    .from('questions')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);

  if (search && String(search).trim()) {
    const escaped = String(search).trim().replace(/[\\%_]/g, (c) => `\\${c}`);
    query = query.ilike('text', `%${escaped}%`);
  }
  if (category) query = query.eq('category', normalizeCategory(category));

  const { data, error, count } = await query;
  if (error) throw dbError(error, 'questions.list');
  return { items: data.map(fromDb), total: count ?? 0, page, pageSize };
}

async function create(input) {
  const { value, error } = validateQuestion(input);
  if (error) throw httpError(400, error);
  const { data, error: dbErr } = await getDb().from('questions').insert(toDb(value)).select().single();
  if (dbErr) throw dbError(dbErr, 'questions.create');
  return fromDb(data);
}

async function createMany(inputs) {
  if (!Array.isArray(inputs) || inputs.length === 0) throw httpError(400, 'Envía una lista de preguntas');
  if (inputs.length > BULK_MAX) throw httpError(400, `Máximo ${BULK_MAX} preguntas por importación`);

  const rows = [];
  for (let i = 0; i < inputs.length; i++) {
    const { value, error } = validateQuestion(inputs[i]);
    if (error) throw httpError(400, `Pregunta ${i + 1}: ${error}`);
    rows.push(toDb(value));
  }
  const { data, error } = await getDb().from('questions').insert(rows).select('id');
  if (error) throw dbError(error, 'questions.createMany');
  return { inserted: data.length };
}

async function update(id, input) {
  const { value, error } = validateQuestion(input);
  if (error) throw httpError(400, error);
  const { data, error: dbErr } = await getDb()
    .from('questions')
    .update(toDb(value))
    .eq('id', id)
    .select()
    .maybeSingle();
  if (dbErr) throw dbError(dbErr, 'questions.update');
  if (!data) throw httpError(404, 'Pregunta no encontrada');
  return fromDb(data);
}

async function remove(id) {
  const { data, error } = await getDb().from('questions').delete().eq('id', id).select('id');
  if (error) throw dbError(error, 'questions.remove');
  if (data.length === 0) throw httpError(404, 'Pregunta no encontrada');
}

async function categories() {
  const { data, error } = await getDb().rpc('question_categories');
  if (error) throw dbError(error, 'questions.categories');
  return data.map((r) => ({ category: r.category, total: Number(r.total) }));
}

module.exports = { list, create, createMany, update, remove, categories };

// ---------- Avisos de errores en preguntas ----------
async function report(questionId, reason, playerId) {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text.length < 2 || text.length > 300) throw httpError(400, 'Explica el error en 2-300 caracteres');
  const { data: exists, error: qErr } = await getDb().from('questions').select('id').eq('id', questionId).maybeSingle();
  if (qErr) throw dbError(qErr, 'questions.report.check');
  if (!exists) throw httpError(404, 'Pregunta no encontrada');
  const { error } = await getDb()
    .from('question_reports')
    .insert({ question_id: questionId, reason: text, player_id: playerId || null });
  if (error) throw dbError(error, 'questions.report');
}

async function listReports() {
  const { data: reports, error } = await getDb()
    .from('question_reports')
    .select('id, question_id, reason, created_at')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw dbError(error, 'questions.listReports');
  if (reports.length === 0) return [];
  const ids = [...new Set(reports.map((r) => r.question_id))];
  const { data: questions, error: qErr } = await getDb().from('questions').select('*').in('id', ids);
  if (qErr) throw dbError(qErr, 'questions.listReports.questions');
  const byId = new Map(questions.map((q) => [q.id, fromDb(q)]));
  const grouped = new Map();
  for (const r of reports) {
    if (!byId.has(r.question_id)) continue;
    if (!grouped.has(r.question_id)) grouped.set(r.question_id, { question: byId.get(r.question_id), reports: [] });
    grouped.get(r.question_id).reports.push({ id: r.id, reason: r.reason, createdAt: r.created_at });
  }
  return [...grouped.values()];
}

async function clearReports(questionId) {
  const { error } = await getDb().from('question_reports').delete().eq('question_id', questionId);
  if (error) throw dbError(error, 'questions.clearReports');
}

module.exports.report = report;
module.exports.listReports = listReports;
module.exports.clearReports = clearReports;
