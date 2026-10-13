// Emparejamiento por nivel: primero rivales de tu rango; cuanto más esperas, más se abre la búsqueda;
// si no hay nadie parecido, cualquier persona; y si no hay nadie, un bot de tu nivel.

const MM = {
  baseWindow: 100, // diferencia de puntos aceptada al empezar a buscar
  growPerSec: 25, // la ventana crece con la espera
  anyoneAfterMs: 8_000, // a partir de aquí vale cualquier persona
};

// Rangos (por puntuación de emparejamiento).
const TIERS = [
  { min: 1700, key: 'maestro', name: 'Maestro', icon: '👑' },
  { min: 1500, key: 'diamante', name: 'Diamante', icon: '💎' },
  { min: 1300, key: 'platino', name: 'Platino', icon: '🔷' },
  { min: 1100, key: 'oro', name: 'Oro', icon: '🥇' },
  { min: 900, key: 'plata', name: 'Plata', icon: '🥈' },
  { min: -Infinity, key: 'bronce', name: 'Bronce', icon: '🥉' },
];

// Puntuación de emparejamiento: el ELO de duelos (cómo respondes) más un poco por experiencia (cuánto juegas).
function matchRating(p) {
  const elo = Number.isFinite(p.rating) ? p.rating : 1000;
  const level = Number.isFinite(p.level) ? p.level : 1;
  return Math.round(elo + Math.min(level - 1, 40) * 5);
}

function tierOf(score) {
  const t = TIERS.find((x) => score >= x.min);
  return { key: t.key, name: t.name, icon: t.icon };
}

const windowFor = (waitedMs) => MM.baseWindow + (waitedMs / 1000) * MM.growPerSec;

// ¿Pueden jugar juntos estos dos que esperan? Vale si cabe en la ventana del que más ha esperado,
// o si cualquiera de los dos ya lleva tanto que acepta a cualquiera.
function compatible(a, b, now) {
  const waitA = now - a.since;
  const waitB = now - b.since;
  if (Math.max(waitA, waitB) >= MM.anyoneAfterMs) return true;
  return Math.abs(a.score - b.score) <= Math.max(windowFor(waitA), windowFor(waitB));
}

// Busca la mejor pareja en la cola: entries = [{ id, score, since }]. Devuelve [idA, idB] o null.
// Prioriza al que lleva más tiempo esperando y, para él, al rival más parecido.
function findPair(entries, now = Date.now()) {
  const byWait = [...entries].sort((a, b) => a.since - b.since);
  for (const a of byWait) {
    let best = null;
    for (const b of byWait) {
      if (b.id === a.id || !compatible(a, b, now)) continue;
      if (!best || Math.abs(a.score - b.score) < Math.abs(a.score - best.score)) best = b;
    }
    if (best) return [a.id, best.id];
  }
  return null;
}

// Para partidas de 3 (Conquista): el que más espera y los n-1 más parecidos que sean compatibles.
function findGroup(entries, n, now = Date.now()) {
  if (entries.length < n) return null;
  const byWait = [...entries].sort((a, b) => a.since - b.since);
  for (const a of byWait) {
    const others = byWait
      .filter((b) => b.id !== a.id && compatible(a, b, now))
      .sort((x, y) => Math.abs(a.score - x.score) - Math.abs(a.score - y.score))
      .slice(0, n - 1);
    if (others.length === n - 1) return [a.id, ...others.map((o) => o.id)];
  }
  return null;
}

// Bot a la medida: con más puntuación, bots que aciertan más.
function botSkillFor(score) {
  const s = 0.45 + (score - 900) / 2000;
  return Math.max(0.35, Math.min(0.85, s));
}

module.exports = { MM, TIERS, matchRating, tierOf, windowFor, compatible, findPair, findGroup, botSkillFor };
