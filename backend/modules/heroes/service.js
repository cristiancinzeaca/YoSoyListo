// Héroes y niveles: crear el personaje, equiparlo y ganar experiencia jugando.
const crypto = require('crypto');
const { getDb, dbError } = require('../../core/db');
const { httpError } = require('../../core/http');
const C = require('./catalog');
const weekly = require('../weekly/service');

const RECREATE_COST = 300; // cambiar de raza/clase/sexo después de crearlo
const SEXES = ['h', 'm']; // hombre / mujer

function power(level, equip) {
  let p = level * 20;
  for (const slot of C.SLOTS) {
    const item = C.ITEMS[equip?.[slot]];
    if (item) p += item.power;
  }
  return p;
}

// ¿Tiene esta pieza? Las normales, por nivel; las de campaña, si las ganó.
function hasItem(item, level, owned) {
  if (!item) return false;
  return item.campaign ? owned.includes(item.id) : item.level <= level;
}

const ownedOf = (row) => (row.campaign && Array.isArray(row.campaign.items) ? row.campaign.items : []);

// Equipo válido: lo que no tenga (o no exista) vuelve a lo básico.
function cleanEquip(equip, level, owned = []) {
  const out = {};
  for (const slot of C.SLOTS) {
    const item = C.ITEMS[equip?.[slot]];
    out[slot] = item && item.slot === slot && hasItem(item, level, owned) ? item.id : C.DEFAULT_EQUIP[slot];
  }
  return out;
}

// Lo que ven los demás jugadores (retrato, nivel, poder, título).
function summary(row) {
  const xp = row.xp ?? 0;
  const { level } = C.levelFromXp(xp);
  const h = row.hero;
  if (!h || !C.RACES[h.race] || !C.CLASSES[h.cls]) return { level, power: power(level, C.DEFAULT_EQUIP), hero: null };
  const equip = cleanEquip(h.equip, level, ownedOf(row));
  return {
    level,
    power: power(level, equip),
    hero: { race: h.race, cls: h.cls, sex: SEXES.includes(h.sex) ? h.sex : 'h', equip, title: C.ITEMS[equip.titulo].name },
  };
}

async function loadRow(playerId) {
  const { data, error } = await getDb().from('players').select('id, name, coins, xp, hero, campaign').eq('id', playerId).maybeSingle();
  if (error) throw dbError(error, 'heroes.load');
  if (!data) throw httpError(404, 'Jugador no encontrado');
  return data;
}

function catalog() {
  const levels = [];
  for (let l = 1; l <= C.MAX_LEVEL; l++) {
    const items = C.itemsAtLevel(l).filter((i) => !i.campaign).map((i) => i.id);
    const unlocks = C.UNLOCKS.filter((u) => u.level === l).map((u) => u.name);
    if (items.length || unlocks.length) levels.push({ level: l, items, unlocks });
  }
  return {
    races: C.RACES,
    classes: C.CLASSES,
    slots: C.SLOTS,
    slotNames: C.SLOT_NAMES,
    items: C.ITEMS,
    levels,
    maxLevel: C.MAX_LEVEL,
    recreateCost: RECREATE_COST,
  };
}

async function me(playerId) {
  const row = await loadRow(playerId);
  const s = summary(row);
  const prog = C.levelFromXp(row.xp ?? 0);
  return {
    ...s,
    xp: row.xp ?? 0,
    xpInto: prog.into,
    xpNext: prog.next,
    unlocked: Object.values(C.ITEMS).filter((i) => hasItem(i, s.level, ownedOf(row))).map((i) => i.id),
    nextRewards: catalog().levels.filter((l) => l.level > s.level).slice(0, 3),
  };
}

function checkLook({ race, cls, sex } = {}) {
  if (!C.RACES[race]) throw httpError(400, 'Elige una raza');
  if (!C.CLASSES[cls]) throw httpError(400, 'Elige una clase');
  if (!SEXES.includes(sex)) throw httpError(400, 'Elige hombre o mujer');
  return { race, cls, sex };
}

// Crear el héroe (gratis la primera vez; luego cambiar de aspecto cuesta monedas).
async function create(playerId, body) {
  const look = checkLook(body);
  const row = await loadRow(playerId);
  const equip = row.hero?.equip || C.DEFAULT_EQUIP;
  if (row.hero) {
    const same = row.hero.race === look.race && row.hero.cls === look.cls && row.hero.sex === look.sex;
    if (same) return me(playerId);
    const { data: paid, error: pErr } = await getDb().rpc('pay_coins', { p_id: playerId, p_amount: RECREATE_COST, p_reason: 'hero:recreate' });
    if (pErr) throw dbError(pErr, 'heroes.recreate.pay');
    if (!paid || !paid[0] || !paid[0].ok) throw httpError(409, `Cambiar de héroe cuesta ${RECREATE_COST} monedas y no tienes suficientes`);
  }
  const { error } = await getDb().from('players').update({ hero: { ...look, equip } }).eq('id', playerId).select('id');
  if (error) throw dbError(error, 'heroes.create');
  return me(playerId);
}

async function equip(playerId, { slot, item } = {}) {
  if (!C.SLOTS.includes(slot)) throw httpError(400, 'Hueco de equipo no válido');
  const it = C.ITEMS[item];
  if (!it || it.slot !== slot) throw httpError(400, 'Ese objeto no va ahí');
  const row = await loadRow(playerId);
  if (!row.hero) throw httpError(409, 'Primero crea tu héroe');
  const { level } = C.levelFromXp(row.xp ?? 0);
  if (it.campaign && !ownedOf(row).includes(it.id)) throw httpError(403, 'Se consigue en la campaña');
  if (!it.campaign && it.level > level) throw httpError(403, `Se desbloquea en el nivel ${it.level}`);
  const equipNow = { ...cleanEquip(row.hero.equip, level, ownedOf(row)), [slot]: it.id };
  const { error } = await getDb().from('players').update({ hero: { ...row.hero, equip: equipNow } }).eq('id', playerId).select('id');
  if (error) throw dbError(error, 'heroes.equip');
  return me(playerId);
}

// Suma XP. Devuelve { gained, xp, level, levelUp, rewards } (rewards = piezas nuevas desbloqueadas).
async function addXp(playerId, amount, reason) {
  const gained = Math.max(0, Math.round(amount || 0));
  if (!gained) return null;
  const { data, error } = await getDb().rpc('add_xp', { p_id: playerId, p_amount: gained });
  if (error) throw dbError(error, `heroes.xp:${reason}`);
  const xp = data && data[0] ? data[0].xp : null;
  if (xp === null || xp === undefined) return null;
  await weekly.safeAdd(playerId, gained); // la liga semanal cuenta la experiencia ganada
  const before = C.levelFromXp(xp - gained).level;
  const after = C.levelFromXp(xp);
  const rewards = [];
  const unlocks = [];
  for (let l = before + 1; l <= after.level; l++) {
    rewards.push(...C.itemsAtLevel(l).filter((i) => !i.campaign).map((i) => ({ id: i.id, name: i.name, slot: i.slot })));
    unlocks.push(...C.UNLOCKS.filter((u) => u.level === l).map((u) => u.name));
  }
  return { gained, xp, level: after.level, xpInto: after.into, xpNext: after.next, levelUp: after.level > before, from: before, rewards, unlocks };
}

// Sin que un fallo de XP rompa el final de una partida.
async function safeXp(playerId, amount, reason) {
  try {
    return await addXp(playerId, amount, reason);
  } catch (err) {
    console.error('[xp] no se pudo sumar', reason, err.message);
    return null;
  }
}

// Los bots también tienen héroe (para que impongan un poco).
function botHero() {
  const pick = (obj) => {
    const keys = Object.keys(obj);
    return keys[crypto.randomInt(keys.length)];
  };
  const level = 1 + crypto.randomInt(15);
  const best = (slot) => {
    const options = Object.values(C.ITEMS).filter((i) => i.slot === slot && !i.campaign && i.level <= level);
    return options[crypto.randomInt(options.length)].id;
  };
  const equipBot = Object.fromEntries(C.SLOTS.map((s) => [s, best(s)]));
  return {
    level,
    power: power(level, equipBot),
    hero: { race: pick(C.RACES), cls: pick(C.CLASSES), sex: SEXES[crypto.randomInt(2)], equip: equipBot, title: C.ITEMS[equipBot.titulo].name },
  };
}

// ¿Tiene ya el nivel para esta opción? Si no, error 403 con el nivel que falta.
function requireUnlock(xp, key, what) {
  const need = C.UNLOCK_LEVEL[key];
  if (!need) return;
  const { level } = C.levelFromXp(xp ?? 0);
  if (level < need) {
    const err = httpError(403, `${what} se desbloquea en el nivel ${need} (ahora tienes el ${level}). ¡Juega partidas para subir!`);
    err.code = 'level';
    throw err;
  }
}

module.exports = { requireUnlock, hasItem, catalog, me, create, equip, addXp, safeXp, summary, botHero, power, RECREATE_COST };
