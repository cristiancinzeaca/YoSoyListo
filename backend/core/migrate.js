const fs = require('fs');
const path = require('path');
const { nameKey, numberedName } = require('../modules/players/names');

// Crea las tablas y carga las preguntas iniciales. Se puede ejecutar siempre:
// no borra nada y no duplica preguntas.
async function migrate(pool) {
  const dir = path.join(__dirname, '..', 'db');
  await pool.query(fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8'));
  await pool.query(fs.readFileSync(path.join(dir, 'seed.sql'), 'utf8'));
  await fillNameKeys(pool);
  const { rows } = await pool.query('select count(*)::int as n from questions');
  return rows[0].n;
}

// Nombres únicos para los jugadores que ya existían: el más antiguo conserva el nombre
// y los repetidos pasan a «Nombre2», «Nombre3»…
async function fillNameKeys(pool) {
  const { rows } = await pool.query('select id, name from players where name_key is null order by created_at, id');
  if (!rows.length) return 0;
  const taken = new Set((await pool.query('select name_key from players where name_key is not null')).rows.map((r) => r.name_key));
  for (const row of rows) {
    let name = row.name;
    for (let n = 2; taken.has(nameKey(name)); n++) name = numberedName(row.name, n);
    const key = nameKey(name);
    taken.add(key);
    await pool.query('update players set name = $1, name_key = $2 where id = $3', [name, key, row.id]);
  }
  console.log(`Nombres únicos: ${rows.length} jugadores revisados`);
  return rows.length;
}

module.exports = { migrate, fillNameKeys };
