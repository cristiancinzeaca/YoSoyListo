// Edad del jugador a partir de su fecha de nacimiento (día de hoy en hora de Madrid).
const MIN_AGE = 14; // en España, por debajo de 14 años hace falta permiso de los padres para guardar datos
const ADULT_AGE = 18;
const BIRTHDAY_GIFT = 500;

function today() {
  // 'YYYY-MM-DD' en Madrid
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
}

const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'string' ? v.slice(0, 10) : null);

function parseDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [y, m, d] = text.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return { y, m, d };
}

function ageOn(birth, on = today()) {
  const b = parseDate(iso(birth));
  const t = parseDate(on);
  if (!b || !t) return null;
  let age = t.y - b.y;
  if (t.m < b.m || (t.m === b.m && t.d < b.d)) age -= 1;
  return age;
}

// ¿Es hoy su cumpleaños? (los nacidos el 29 de febrero lo celebran el 28 en años no bisiestos)
function isBirthday(birth, on = today()) {
  const b = parseDate(iso(birth));
  const t = parseDate(on);
  if (!b || !t) return false;
  if (b.m === t.m && b.d === t.d) return true;
  const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return b.m === 2 && b.d === 29 && t.m === 2 && t.d === 28 && !leap(t.y);
}

module.exports = { MIN_AGE, ADULT_AGE, BIRTHDAY_GIFT, today, parseDate, ageOn, isBirthday, iso };
