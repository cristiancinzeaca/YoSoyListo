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
