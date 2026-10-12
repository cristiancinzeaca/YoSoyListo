const { createClient } = require('@supabase/supabase-js');
const { httpError } = require('./http');

let client = null;

// Cliente de Supabase con la service_role key. Solo se usa en el servidor:
// esta clave nunca debe llegar al navegador.
function getDb() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw httpError(503, 'Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en las variables de entorno');
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

// Convierte un error de Supabase en un error HTTP 500 con mensaje legible en los logs.
function dbError(error, context) {
  const err = httpError(500, 'Error de base de datos');
  err.cause = error;
  err.context = context;
  return err;
}

// Solo para los tests: permite usar una base de datos simulada.
function setDbForTests(fake) {
  client = fake;
}

module.exports = { getDb, dbError, setDbForTests };
