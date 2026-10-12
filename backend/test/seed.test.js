const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('las preguntas iniciales son válidas, no se repiten y seed.sql está al día', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'db', 'build-seed.js'), '--check'], {
    encoding: 'utf8',
  });
  assert.match(out, /al día: \d+ preguntas/);
});
