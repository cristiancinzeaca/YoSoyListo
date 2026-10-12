const { createClient } = require('@supabase/supabase-js');
const { httpError } = require('./http');
const { createPgDb } = require('./pgdb');

let client = null;

// Dos formas de conectar la base de datos:
//  - DATABASE_URL: PostgreSQL directo (por ejemplo, el de Railway). Es la más sencilla.
//  - SUPABASE_URL + SUPABASE_SERVICE_KEY: a través de la API de Supabase.
// Las claves solo se usan en el servidor: nunca llegan al navegador.
function getDb() {
  if (client) return client;
  if (process.env.DATABASE_URL) {
    client = createPgDb(process.env.DATABASE_URL);
    return client;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw httpError(503, 'Falta configurar la base de datos (DATABASE_URL, o SUPABASE_URL y SUPABASE_SERVICE_KEY)');
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
