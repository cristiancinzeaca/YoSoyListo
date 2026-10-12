const fs = require('fs');
const path = require('path');

// Crea las tablas y carga las preguntas iniciales. Se puede ejecutar siempre:
// no borra nada y no duplica preguntas.
async function migrate(pool) {
  const dir = path.join(__dirname, '..', 'db');
  await pool.query(fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8'));
  await pool.query(fs.readFileSync(path.join(dir, 'seed.sql'), 'utf8'));
  const { rows } = await pool.query('select count(*)::int as n from questions');
  return rows[0].n;
}

module.exports = { migrate };
