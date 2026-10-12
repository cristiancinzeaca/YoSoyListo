const { getDb, dbError } = require('../../core/db');
const { httpError } = require('../../core/http');
const { HELPERS, AVATARS, FREE_AVATARS, COINS, avatarItem } = require('./catalog');

async function wallet(playerId) {
  const db = getDb();
  const [player, items] = await Promise.all([
    db.from('players').select('coins, avatar').eq('id', playerId).maybeSingle(),
    db.from('player_items').select('item, qty').eq('player_id', playerId),
  ]);
  if (player.error) throw dbError(player.error, 'shop.wallet.player');
  if (items.error) throw dbError(items.error, 'shop.wallet.items');
  if (!player.data) throw httpError(404, 'Jugador no encontrado');
  const helpers = Object.fromEntries(Object.keys(HELPERS).map((k) => [k, 0]));
  const avatars = new Set(FREE_AVATARS);
  for (const { item, qty } of items.data) {
    if (HELPERS[item]) helpers[item] = qty;
    else if (item.startsWith('avatar:') && qty > 0) avatars.add(item.slice(7));
  }
  return { coins: player.data.coins, avatar: player.data.avatar, helpers, avatars: [...avatars] };
}

function catalog() {
  return {
    helpers: Object.entries(HELPERS).map(([id, h]) => ({ id, ...h })),
    avatars: Object.entries(AVATARS).map(([id, a]) => ({ id, ...a })),
    coins: {
      welcome: COINS.welcome,
      dailyCap: COINS.dailyCap,
      dailyBonus: COINS.dailyBonus,
      blitzPerCorrect: COINS.blitzPerCorrect,
      blitzPersonalBest: COINS.blitzPersonalBest,
      duel: COINS.duel,
      room: COINS.room,
      conquista: COINS.conquista,
      botFactor: COINS.botFactor,
    },
  };
}

async function buy(playerId, item) {
  let price;
  let unique = false;
  let dbItem;
  if (typeof item === 'string' && HELPERS[item]) {
    price = HELPERS[item].price;
    dbItem = item;
  } else if (typeof item === 'string' && item.startsWith('avatar:') && AVATARS[item.slice(7)]) {
    const key = item.slice(7);
    if (AVATARS[key].price === 0) throw httpError(400, 'Ese avatar es gratis');
    price = AVATARS[key].price;
    unique = true;
    dbItem = avatarItem(key);
  } else {
    throw httpError(400, 'Ese artículo no existe');
  }
  const { data, error } = await getDb().rpc('buy_item', {
    p_id: playerId,
    p_item: dbItem,
    p_price: price,
    p_qty: 1,
    p_unique: unique,
  });
  if (error) throw dbError(error, 'shop.buy');
  const row = data && data[0];
  if (!row) throw httpError(404, 'Jugador no encontrado');
  if (!row.ok) throw httpError(409, unique && row.item_qty > 0 ? 'Ya tienes ese avatar' : 'No tienes monedas suficientes');
  return wallet(playerId);
}

async function setAvatar(playerId, key) {
  if (typeof key !== 'string' || !AVATARS[key]) throw httpError(400, 'Ese avatar no existe');
  const w = await wallet(playerId);
  if (!w.avatars.includes(key)) throw httpError(403, 'Primero tienes que comprar ese avatar');
  const { error } = await getDb().from('players').update({ avatar: key }).eq('id', playerId).select('id');
  if (error) throw dbError(error, 'shop.setAvatar');
  return { ...w, avatar: key };
}

// Gasta un comodín. Devuelve cuántos quedan, o null si no tenía.
async function useItem(playerId, kind) {
  if (!HELPERS[kind]) return null;
  const { data, error } = await getDb().rpc('use_item', { p_id: playerId, p_item: kind });
  if (error) throw dbError(error, 'shop.useItem');
  return data && data.length ? data[0].item_left : null;
}

// Devuelve un comodín (si algo falló justo después de gastarlo).
async function refundItem(playerId, kind) {
  const { data, error } = await getDb().from('player_items').select('qty').eq('player_id', playerId).eq('item', kind).maybeSingle();
  if (error || !data) return;
  await getDb().from('player_items').update({ qty: data.qty + 1 }).eq('player_id', playerId).eq('item', kind).select('qty');
}

// Monedas de una partida (respeta el tope diario). reason: «game:blitz», «game:duel»...
async function award(playerId, amount, reason) {
  const { data, error } = await getDb().rpc('award_coins', {
    p_id: playerId,
    p_amount: Math.max(0, Math.round(amount)),
    p_reason: reason,
    p_daily_cap: COINS.dailyCap,
    p_daily_bonus: COINS.dailyBonus,
  });
  if (error) throw dbError(error, 'shop.award');
  const row = data && data[0];
  return row ? { awarded: row.awarded, bonus: row.bonus, balance: row.balance } : { awarded: 0, bonus: 0, balance: null };
}

// Regalo de bienvenida al crear la cuenta.
async function grantWelcome(playerId) {
  const db = getDb();
  const rows = Object.entries(COINS.welcomeItems).map(([item, qty]) => ({ player_id: playerId, item, qty }));
  const { error } = await db.from('player_items').insert(rows);
  if (error) throw dbError(error, 'shop.welcome.items');
  const { error: e2 } = await db.from('coin_ledger').insert({ player_id: playerId, amount: COINS.welcome, reason: 'bonus:welcome' });
  if (e2) throw dbError(e2, 'shop.welcome.ledger');
}

module.exports = { wallet, catalog, buy, setAvatar, useItem, refundItem, award, grantWelcome };
