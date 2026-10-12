// Genera db/seed.sql a partir de los archivos db/questions/<categoria>.json.
// Formato de cada pregunta: [texto, respuesta correcta, [incorrectas], dificultad, explicación|null]
// La posición de la respuesta correcta se decide con un hash del texto: siempre la misma, pero variada.
// Uso: node db/build-seed.js          (regenera seed.sql)
//      node db/build-seed.js --check  (solo comprueba que seed.sql está al día)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateQuestion, normalizeCategory } = require('../modules/questions/validate');

const dir = path.join(__dirname, 'questions');
const sqlString = (s) => (s === null ? 'null' : `'${s.replace(/'/g, "''")}'`);
const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

const seen = new Map();
const rows = [];
const counts = {};
let errors = 0;

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const category = path.basename(file, '.json');
  const items = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  for (const [text, correct, wrong, difficulty, explanation] of items) {
    const n = wrong.length + 1;
    const pos = crypto.createHash('md5').update(text).digest()[0] % n;
    const options = [...wrong];
    options.splice(pos, 0, correct);
    const { value, error } = validateQuestion({ text, options, correctIndex: pos, category, difficulty, explanation });
    const key = normalize(text);
    if (error) {
      console.error(`✗ ${file}: «${text}» → ${error}`);
      errors++;
      continue;
    }
    if (seen.has(key)) {
      console.error(`✗ ${file}: pregunta repetida (también en ${seen.get(key)}): «${text}»`);
      errors++;
      continue;
    }
    seen.set(key, file);
    counts[category] = (counts[category] || 0) + 1;
    rows.push(
      `(${sqlString(value.text)}, array[${value.options.map(sqlString).join(', ')}], ${value.correctIndex}, ` +
        `${sqlString(value.category)}, ${value.difficulty}, ${sqlString(value.explanation)})`
    );
  }
}

// Preguntas de aproximación (modo Conquista): db/numeric/*.json → [texto, respuesta, unidad, categoría]
const numericRows = [];
const numericDir = path.join(__dirname, 'numeric');
for (const file of fs.readdirSync(numericDir).filter((f) => f.endsWith('.json')).sort()) {
  for (const [text, answer, unit, category] of JSON.parse(fs.readFileSync(path.join(numericDir, file), 'utf8'))) {
    const key = `n:${normalize(text)}`;
    if (typeof text !== 'string' || text.trim().length < 5 || text.length > 500 || !Number.isFinite(answer)) {
      console.error(`✗ numeric/${file}: «${text}» no es válida`);
      errors++;
      continue;
    }
    if (seen.has(key)) {
      console.error(`✗ numeric/${file}: pregunta repetida: «${text}»`);
      errors++;
      continue;
    }
    seen.set(key, file);
    numericRows.push(`(${sqlString(text.trim())}, ${answer}, ${sqlString(unit || null)}, ${sqlString(normalizeCategory(category))})`);
  }
}

if (errors) {
  console.error(`\n${errors} errores: no se ha generado seed.sql`);
  process.exit(1);
}

const sql = `-- Preguntas iniciales (${rows.length}). GENERADO por db/build-seed.js: no editar a mano.
-- Ejecutar DESPUÉS de schema.sql. Si se ejecuta otra vez, no duplica las preguntas que ya existen.
insert into questions (text, options, correct_index, category, difficulty, explanation)
select v.text, v.options, v.correct_index, v.category, v.difficulty, v.explanation
from (values
${rows.join(',\n')}
) as v (text, options, correct_index, category, difficulty, explanation)
where not exists (select 1 from questions q where q.text = v.text);

-- Preguntas de aproximación (${numericRows.length}) para el modo Conquista.
insert into numeric_questions (text, answer, unit, category)
select v.text, v.answer, v.unit, v.category
from (values
${numericRows.join(',\n')}
) as v (text, answer, unit, category)
where not exists (select 1 from numeric_questions n where n.text = v.text);
`;
const target = path.join(__dirname, 'seed.sql');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== sql) {
    console.error('seed.sql no está al día: ejecuta «npm run seed»');
    process.exit(1);
  }
  console.log(`seed.sql al día: ${rows.length} preguntas`);
} else {
  fs.writeFileSync(target, sql);
  console.log(`seed.sql generado: ${rows.length} preguntas y ${numericRows.length} de aproximación`, counts);
}
