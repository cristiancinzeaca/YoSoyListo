// Adaptador para usar PostgreSQL directamente (por ejemplo, la base de datos de Railway)
// con la misma forma de consulta que el cliente de Supabase que usa el resto del código:
//   db.from('tabla').select('a, b').eq('id', x).maybeSingle()  →  { data, error, count }
const { Pool, types } = require('pg');

// Fechas como texto ISO (igual que Supabase) y números grandes como número.
types.setTypeParser(1184, (v) => new Date(v).toISOString()); // timestamptz
types.setTypeParser(1114, (v) => new Date(`${v}Z`).toISOString()); // timestamp
types.setTypeParser(20, (v) => Number(v)); // int8 / count(*)

const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name) {
  if (!IDENT.test(name)) throw new Error(`Identificador SQL no válido: ${name}`);
  return `"${name}"`;
}

function columns(cols) {
  if (!cols || cols.trim() === '*') return '*';
  return cols
    .split(',')
    .map((c) => ident(c.trim()))
    .join(', ');
}

class Query {
  constructor(pool, table) {
    this.pool = pool;
    this.table = ident(table);
    this.op = 'select';
    this.cols = '*';
    this.where = [];
    this.params = [];
    this.orders = [];
  }

  param(value) {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  select(cols = '*', opts = {}) {
    this.cols = columns(cols);
    this.returning = true;
    if (opts.count) this.countMode = true;
    if (opts.head) this.head = true;
    return this;
  }
  insert(rows) {
    this.op = 'insert';
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(values) {
    this.op = 'update';
    this.values = values;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }

  eq(c, v) {
    this.where.push(`${ident(c)} = ${this.param(v)}`);
    return this;
  }
  gt(c, v) {
    this.where.push(`${ident(c)} > ${this.param(v)}`);
    return this;
  }
  gte(c, v) {
    this.where.push(`${ident(c)} >= ${this.param(v)}`);
    return this;
  }
  in(c, values) {
    this.where.push(`${ident(c)} = any(${this.param(values)})`);
    return this;
  }
  ilike(c, pattern) {
    this.where.push(`${ident(c)} ilike ${this.param(pattern)}`);
    return this;
  }
  is(c, v) {
    if (v !== null) throw new Error('is() solo admite null');
    this.where.push(`${ident(c)} is null`);
    return this;
  }
  not(c, op, v) {
    if (op !== 'is' || v !== null) throw new Error('not() solo admite («is», null)');
    this.where.push(`${ident(c)} is not null`);
    return this;
  }
  order(c, { ascending = true } = {}) {
    this.orders.push(`${ident(c)} ${ascending ? 'asc' : 'desc'}`);
    return this;
  }
  range(from, to) {
    this.offset = from;
    this.limitN = to - from + 1;
    return this;
  }
  limit(n) {
    this.limitN = n;
    return this;
  }
  single() {
    this.singleMode = 'single';
    return this;
  }
  maybeSingle() {
    this.singleMode = 'maybe';
    return this;
  }

  whereSql() {
    return this.where.length ? ` where ${this.where.join(' and ')}` : '';
  }

  async run() {
    let sql;
    let count = null;
    const returning = this.returning ? ` returning ${this.cols}` : '';

    if (this.op === 'select') {
      const where = this.whereSql();
      if (this.countMode) {
        const res = await this.pool.query(`select count(*) as n from ${this.table}${where}`, this.params);
        count = res.rows[0].n;
        if (this.head) return { data: null, error: null, count };
      }
      sql = `select ${this.cols} from ${this.table}${where}`;
      if (this.orders.length) sql += ` order by ${this.orders.join(', ')}`;
      if (this.limitN !== undefined) sql += ` limit ${Number(this.limitN)}`;
      if (this.offset !== undefined) sql += ` offset ${Number(this.offset)}`;
    } else if (this.op === 'insert') {
      const keys = [...new Set(this.rows.flatMap((r) => Object.keys(r)))];
      const tuples = this.rows.map(
        (r) => `(${keys.map((k) => (r[k] === undefined ? 'default' : this.param(toPg(r[k])))).join(', ')})`
      );
      sql = `insert into ${this.table} (${keys.map(ident).join(', ')}) values ${tuples.join(', ')}${returning}`;
    } else if (this.op === 'update') {
      const sets = Object.entries(this.values).map(([k, v]) => `${ident(k)} = ${this.param(toPg(v))}`);
      sql = `update ${this.table} set ${sets.join(', ')}${this.whereSql()}${returning}`;
    } else {
      sql = `delete from ${this.table}${this.whereSql()}${returning}`;
    }

    const res = await this.pool.query(sql, this.params);
    let data = this.returning ? res.rows : null;
    if (this.singleMode && data) {
      if (data.length > 1 || (this.singleMode === 'single' && data.length === 0)) {
        return { data: null, error: { message: `Se esperaba una fila y hay ${data.length}` }, count };
      }
      data = data[0] ?? null;
    }
    return { data, error: null, count };
  }

  then(resolve, reject) {
    return this.run()
      .catch((error) => ({ data: null, error, count: null }))
      .then(resolve, reject);
  }
}

// Los objetos (jsonb) se envían como texto JSON; las listas, como arrays de PostgreSQL.
function toPg(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
    return JSON.stringify(value);
  }
  return value;
}

function sslFor(url) {
  if (/sslmode=disable/.test(url)) return false;
  if (/localhost|127\.0\.0\.1|\.railway\.internal|host=\//.test(url)) return false;
  return { rejectUnauthorized: false };
}

function createPgDb(connectionString) {
  const pool = new Pool({ connectionString, ssl: sslFor(connectionString), max: 10 });
  pool.on('error', (err) => console.error('[db] error en la conexión', err.message));
  return {
    pool,
    from: (table) => new Query(pool, table),
    async rpc(name, args = {}) {
      try {
        const named = Object.keys(args).map((k, i) => `${ident(k)} => $${i + 1}`);
        const res = await pool.query(`select * from ${ident(name)}(${named.join(', ')})`, Object.values(args));
        return { data: res.rows, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  };
}

module.exports = { createPgDb };
