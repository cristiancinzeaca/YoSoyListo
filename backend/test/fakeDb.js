// Base de datos falsa en memoria que imita la parte del cliente de Supabase
// que usa el backend. Solo para tests.
const crypto = require('crypto');

function createFakeDb() {
  const tables = {
    questions: [], numeric_questions: [], blitz_sessions: [], players: [], question_reports: [], matches: [], match_players: [],
    player_sessions: [], player_items: [], coin_ledger: [], country_owners: [], country_attacks: [],
    chat_messages: [], chat_reports: [], chat_blocks: [], chat_reads: [],
  };

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
    neq(c, v) { this.filters.push((r) => r[c] !== v); return this; }
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
          created_at: nextTime(),
          ...defaults(this.table),
          ...structuredClone(row),
        }));
        if (this.table === 'players' && list.some((n) => n.name_key && rows.some((r) => r.name_key === n.name_key))) {
          return { data: null, error: { code: '23505', constraint: 'players_name_key_idx', message: 'duplicate key value violates unique constraint "players_name_key_idx"' } };
        }
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

  // Fechas siempre crecientes (en los tests se insertan varias filas en el mismo milisegundo).
  let lastTime = 0;
  function nextTime() {
    lastTime = Math.max(Date.now(), lastTime + 1);
    return new Date(lastTime).toISOString();
  }

  function defaults(table) {
    if (table === 'chat_messages') return { recipient_id: null, hidden: false };
    if (table === 'chat_reports') return { resolved: false };
    if (table === 'questions') return { category: 'general', difficulty: 2, explanation: null, active: true };
    if (table === 'players') {
      return {
        rating: 1000, duels_played: 0, duels_won: 0, rooms_played: 0, rooms_won: 0, conquista_played: 0, conquista_won: 0,
        token_hash: null, google_sub: null, email: null, coins: 0, avatar: null, xp: 0, hero: null, birthdate: null, birthday_gift_year: null,
      };
    }
    if (table === 'country_owners') {
      const now = new Date().toISOString();
      return { defense: [], fortify: 0, income_at: now, bought_at: now, defenses_won: 0 };
    }
    if (table === 'country_attacks') return { current: 0, status: 'active' };
    if (table !== 'blitz_sessions') return {};
    return {
      answers: {}, score: 0, correct_count: 0, answered_count: 0, streak: 0, best_streak: 0,
      finished_at: null, player_name: null, category: null, helpers: {}, coins: null,
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
      if (name === 'award_coins') {
        const p = tables.players.find((x) => x.id === args.p_id);
        if (!p) return { data: [], error: null };
        const today = new Date().toISOString().slice(0, 10);
        const games = tables.coin_ledger.filter(
          (l) => l.player_id === p.id && l.reason.startsWith('game:') && l.created_at.slice(0, 10) === today
        );
        const earned = games.reduce((sum, l) => sum + l.amount, 0);
        const give = Math.max(0, Math.min(args.p_amount, args.p_daily_cap - earned));
        const bonus = games.length === 0 ? args.p_daily_bonus : 0;
        const now = new Date().toISOString();
        tables.coin_ledger.push({ player_id: p.id, amount: give, reason: args.p_reason, created_at: now });
        if (bonus) tables.coin_ledger.push({ player_id: p.id, amount: bonus, reason: 'bonus:daily', created_at: now });
        p.coins += give + bonus;
        return { data: [{ awarded: give, bonus, balance: p.coins }], error: null };
      }
      if (name === 'buy_item') {
        const p = tables.players.find((x) => x.id === args.p_id);
        if (!p) return { data: [], error: null };
        let row = tables.player_items.find((r) => r.player_id === p.id && r.item === args.p_item);
        const qty = row ? row.qty : 0;
        if ((args.p_unique && qty > 0) || p.coins < args.p_price) {
          return { data: [{ ok: false, coins_left: p.coins, item_qty: qty }], error: null };
        }
        p.coins -= args.p_price;
        if (!row) {
          row = { player_id: p.id, item: args.p_item, qty: 0 };
          tables.player_items.push(row);
        }
        row.qty += args.p_qty;
        tables.coin_ledger.push({ player_id: p.id, amount: -args.p_price, reason: `buy:${args.p_item}`, created_at: new Date().toISOString() });
        return { data: [{ ok: true, coins_left: p.coins, item_qty: row.qty }], error: null };
      }
      if (name === 'use_item') {
        const row = tables.player_items.find((r) => r.player_id === args.p_id && r.item === args.p_item && r.qty > 0);
        if (!row) return { data: [], error: null };
        row.qty -= 1;
        return { data: [{ item_left: row.qty }], error: null };
      }
      const player = (id) => tables.players.find((x) => x.id === id);
      const ledger = (id, amount, reason) => tables.coin_ledger.push({ player_id: id, amount, reason, created_at: new Date().toISOString() });
      if (name === 'mark_chat_read') {
        const r = tables.chat_reads.find((x) => x.player_id === args.p_player && x.channel === args.p_channel);
        if (r) r.read_at = nextTime();
        else tables.chat_reads.push({ player_id: args.p_player, channel: args.p_channel, read_at: nextTime() });
        return { data: null, error: null };
      }
      if (name === 'block_player') {
        if (!tables.chat_blocks.some((b) => b.blocker_id === args.p_blocker && b.blocked_id === args.p_blocked)) {
          tables.chat_blocks.push({ blocker_id: args.p_blocker, blocked_id: args.p_blocked, created_at: nextTime() });
        }
        return { data: null, error: null };
      }
      if (name === 'report_chat_message') {
        const msg = tables.chat_messages.find((m) => m.id === args.p_message);
        if (!msg) return { data: [], error: null };
        const wasHidden = msg.hidden;
        if (!tables.chat_reports.some((r) => r.message_id === msg.id && r.reporter_id === args.p_reporter)) {
          tables.chat_reports.push({ message_id: msg.id, reporter_id: args.p_reporter, reason: args.p_reason, resolved: false, created_at: nextTime() });
        }
        const n = tables.chat_reports.filter((r) => r.message_id === msg.id && !r.resolved).length;
        let muted = false;
        if (n >= args.p_hide_at && !wasHidden) {
          msg.hidden = true;
          const hid = tables.chat_messages.filter((m) => m.sender_id === msg.sender_id && m.hidden).length;
          if (hid >= args.p_mute_after) {
            player(msg.sender_id).chat_muted_until = new Date(Date.now() + args.p_mute_hours * 3600_000).toISOString();
            muted = true;
          }
        }
        return { data: [{ reports: n, hidden: wasHidden || n >= args.p_hide_at, muted }], error: null };
      }
      if (name === 'prune_chat') return { data: 0, error: null };
      if (name === 'rename_player') {
        const p = player(args.p_id);
        if (!p) return { data: [], error: null };
        if (tables.players.some((x) => x.id !== p.id && x.name_key === args.p_key)) {
          return { data: [{ ok: false, reason: 'taken', cost: 0, coins_left: p.coins }], error: null };
        }
        const cost = p.name_key === args.p_key ? 0 : args.p_cost;
        if (p.coins < cost) return { data: [{ ok: false, reason: 'coins', cost, coins_left: p.coins }], error: null };
        p.coins -= cost;
        p.name = args.p_name;
        p.name_key = args.p_key;
        if (cost) ledger(p.id, -cost, 'rename');
        return { data: [{ ok: true, reason: null, cost, coins_left: p.coins }], error: null };
      }
      if (name === 'birthday_gift') {
        const p = player(args.p_id);
        if (!p || (p.birthday_gift_year && p.birthday_gift_year >= args.p_year)) return { data: [], error: null };
        p.coins += args.p_amount;
        p.birthday_gift_year = args.p_year;
        ledger(p.id, args.p_amount, 'gift:birthday');
        return { data: [{ balance: p.coins }], error: null };
      }
      if (name === 'add_xp') {
        const p = player(args.p_id);
        if (!p) return { data: [], error: null };
        p.xp = (p.xp || 0) + Math.max(0, args.p_amount);
        return { data: [{ xp: p.xp }], error: null };
      }
      if (name === 'pay_coins') {
        const p = player(args.p_id);
        if (!p || p.coins < args.p_amount) return { data: [{ ok: false, balance: p ? p.coins : null }], error: null };
        p.coins -= args.p_amount;
        ledger(p.id, -args.p_amount, args.p_reason);
        return { data: [{ ok: true, balance: p.coins }], error: null };
      }
      if (name === 'add_coins') {
        const p = player(args.p_id);
        if (!p) return { data: [], error: null };
        p.coins += args.p_amount;
        ledger(p.id, args.p_amount, args.p_reason);
        return { data: [{ balance: p.coins }], error: null };
      }
      if (name === 'buy_country') {
        const p = player(args.p_id);
        if (!p) return { data: [], error: null };
        if (tables.country_owners.some((o) => o.country === args.p_country)) return { data: [{ ok: false, reason: 'taken', coins_left: p.coins }], error: null };
        if (p.coins < args.p_price) return { data: [{ ok: false, reason: 'coins', coins_left: p.coins }], error: null };
        p.coins -= args.p_price;
        const now = new Date().toISOString();
        tables.country_owners.push({ country: args.p_country, player_id: p.id, value: args.p_price, defense: [], fortify: 0, income_at: now, bought_at: now, defenses_won: 0 });
        ledger(p.id, -args.p_price, `country:buy:${args.p_country}`);
        return { data: [{ ok: true, reason: 'ok', coins_left: p.coins }], error: null };
      }
      if (name === 'collect_income') {
        const p = player(args.p_id);
        if (!p) return { data: [], error: null };
        let total = 0;
        const now = Date.now();
        for (const o of tables.country_owners.filter((x) => x.player_id === p.id)) {
          total += Math.floor(o.value * args.p_rate * Math.min((now - Date.parse(o.income_at)) / 86400000, args.p_max_days));
          o.income_at = new Date(now).toISOString();
        }
        p.coins += total;
        if (total) ledger(p.id, total, 'country:income');
        return { data: [{ amount: total, balance: p.coins }], error: null };
      }
      if (name === 'conquer_country') {
        const o = tables.country_owners.find((x) => x.country === args.p_country && x.player_id === args.p_owner);
        if (!o) return { data: [{ ok: false, compensation: 0 }], error: null };
        const comp = Math.floor(o.value * args.p_compensation);
        Object.assign(o, { player_id: args.p_attacker, defense: [], fortify: 0, income_at: new Date().toISOString(), defenses_won: 0 });
        const prev = player(args.p_owner);
        if (prev) prev.coins += comp;
        ledger(args.p_owner, comp, `country:compensation:${args.p_country}`);
        return { data: [{ ok: true, compensation: comp }], error: null };
      }
      if (name === 'defend_country') {
        const o = tables.country_owners.find((x) => x.country === args.p_country && x.player_id === args.p_owner);
        if (o) {
          o.value += args.p_gain;
          o.defenses_won += 1;
          const p = player(args.p_owner);
          if (p) p.coins += args.p_fee;
          ledger(args.p_owner, args.p_fee, `country:defense:${args.p_country}`);
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
