// Base de datos falsa en memoria que imita la parte del cliente de Supabase
// que usa el backend. Solo para tests.
const crypto = require('crypto');

function createFakeDb() {
  const tables = { questions: [], numeric_questions: [], blitz_sessions: [], players: [], question_reports: [], matches: [], match_players: [] };

  class Query {
    constructor(table) {
      this.table = table;
      this.op = 'select';
      this.filters = [];
      this.orders = [];
    }
    select(cols, opts = {}) {
      if (this.op === 'select') this.countMode = opts.count;
      this.head = opts.head;
      this.returning = true;
      return this;
    }
    insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
    update(obj) { this.op = 'update'; this.payload = obj; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
    is(c, v) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
    not(c, op, v) { this.filters.push((r) => (r[c] ?? null) !== v); return this; }
    in(c, values) { this.filters.push((r) => values.includes(r[c])); return this; }
    gt(c, v) { this.filters.push((r) => r[c] > v); return this; }
    gte(c, v) { this.filters.push((r) => r[c] >= v); return this; }
    ilike(c, pattern) {
      const needle = pattern.replace(/^%|%$/g, '').replace(/\\(.)/g, '$1').toLowerCase();
      this.filters.push((r) => r[c].toLowerCase().includes(needle));
      return this;
    }
    order(c, { ascending = true } = {}) { this.orders.push([c, ascending]); return this; }
    range(from, to) { this.rangeArgs = [from, to]; return this; }
    limit(n) { this.limitN = n; return this; }
    single() { this.singleMode = 'single'; return this; }
    maybeSingle() { this.singleMode = 'maybe'; return this; }

    run() {
      const rows = tables[this.table];
      const match = (r) => this.filters.every((f) => f(r));
      let data;
      if (this.op === 'insert') {
        const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((row) => ({
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          ...defaults(this.table),
          ...structuredClone(row),
        }));
        rows.push(...list);
        data = list;
      } else if (this.op === 'update') {
        data = rows.filter(match);
        data.forEach((r) => Object.assign(r, structuredClone(this.payload)));
      } else if (this.op === 'delete') {
        data = rows.filter(match);
        tables[this.table] = rows.filter((r) => !match(r));
      } else {
        data = rows.filter(match);
        for (const [c, asc] of [...this.orders].reverse()) {
          data = [...data].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
        }
      }
      const count = data.length;
      if (this.rangeArgs) data = data.slice(this.rangeArgs[0], this.rangeArgs[1] + 1);
      if (this.limitN !== undefined) data = data.slice(0, this.limitN);
      data = structuredClone(data);
      if (this.head) data = null;
      if (this.singleMode) {
        if (data.length > 1 || (this.singleMode === 'single' && data.length === 0)) {
          return { data: null, error: { message: 'single row expected' } };
        }
        data = data[0] ?? null;
      }
      return { data, error: null, count: this.countMode ? count : null };
    }
    then(resolve, reject) {
      return Promise.resolve().then(() => this.run()).then(resolve, reject);
    }
  }

  function defaults(table) {
    if (table === 'questions') return { category: 'general', difficulty: 2, explanation: null, active: true };
    if (table === 'players') {
      return { rating: 1000, duels_played: 0, duels_won: 0, rooms_played: 0, rooms_won: 0, conquista_played: 0, conquista_won: 0 };
    }
    if (table !== 'blitz_sessions') return {};
    return {
      answers: {}, score: 0, correct_count: 0, answered_count: 0, streak: 0, best_streak: 0,
      finished_at: null, player_name: null, category: null,
    };
  }

  return {
    tables,
    from: (table) => new Query(table),
    async rpc(name, args) {
      const active = tables.questions.filter((q) => q.active);
      if (name === 'random_questions') {
        const pool = active.filter((q) => !args.p_category || q.category === args.p_category);
        return { data: structuredClone(pool.slice(0, args.p_limit)), error: null };
      }
      if (name === 'apply_player_result') {
        const p = tables.players.find((x) => x.id === args.p_id);
        if (p) {
          if (args.p_rating !== null && args.p_rating !== undefined) p.rating = args.p_rating;
          p.duels_played += args.p_duels;
          p.duels_won += args.p_duel_wins;
          p.rooms_played += args.p_rooms;
          p.rooms_won += args.p_room_wins;
        }
        return { data: null, error: null };
      }
      if (name === 'random_numeric_questions') {
        return { data: structuredClone(tables.numeric_questions.slice(0, args.p_limit)), error: null };
      }
      if (name === 'apply_conquista_result') {
        const p = tables.players.find((x) => x.id === args.p_id);
        if (p) {
          p.conquista_played += 1;
          p.conquista_won += args.p_won;
        }
        return { data: null, error: null };
      }
      if (name === 'question_categories') {
        const counts = {};
        for (const q of active) counts[q.category] = (counts[q.category] || 0) + 1;
        return { data: Object.entries(counts).map(([category, total]) => ({ category, total })), error: null };
      }
      return { data: null, error: { message: `rpc desconocida ${name}` } };
    },
  };
}

module.exports = { createFakeDb };
