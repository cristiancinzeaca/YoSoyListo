// Versión para portales de juegos (CrazyGames…): idioma (español / inglés) y ajustes de portal.
// Se carga la primera en las páginas de /portal. En la web normal no hace nada.
(function () {
  const PORTAL = location.pathname === '/portal' || location.pathname.startsWith('/portal/');
  const ls = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch {
        // sin almacenamiento (modo incógnito estricto): se usa lo de la URL
      }
    },
  };

  // Idioma: ?lang= (lo pone el portal) → el elegido antes → el del navegador. Español o inglés.
  const params = new URLSearchParams(location.search);
  let lang = params.get('lang') || ls.get('ysl:lang') || (navigator.language || 'en');
  lang = String(lang).toLowerCase().startsWith('es') ? 'es' : 'en';
  if (PORTAL) {
    ls.set('ysl:lang', lang);
    if (params.get('portal')) ls.set('ysl:portal', params.get('portal'));
  }
  const source = ls.get('ysl:portal') || params.get('portal') || 'crazygames';
  const EN = PORTAL && lang === 'en';

  // Avisos al portal (la página de CrazyGames que nos contiene llama a su SDK).
  function notify(event) {
    if (!PORTAL || window.parent === window) return;
    try {
      window.parent.postMessage({ ysl: event }, '*');
    } catch {
      // sin portal
    }
  }

  window.YSL = {
    portal: PORTAL,
    source,
    lang: PORTAL ? lang : 'es',
    en: EN,
    t: (es, en) => (EN ? en : es),
    home: PORTAL ? `/portal?lang=${lang}` : '/',
    notify,
    setLang(l) {
      ls.set('ysl:lang', l === 'es' ? 'es' : 'en');
    },
  };
  if (!PORTAL) return;
  document.documentElement.classList.add('portal');
  document.documentElement.lang = lang;
  if (!EN) return;

  // ---------- traducción de la interfaz (español → inglés) ----------
  const TIERS = { Maestro: 'Master', Diamante: 'Diamond', Platino: 'Platinum', Oro: 'Gold', Plata: 'Silver', Bronce: 'Bronze' };
  const RACES = { Humano: 'Human', Humana: 'Human', Elfo: 'Elf', Elfa: 'Elf', Enano: 'Dwarf', Enana: 'Dwarf', Orco: 'Orc', Orca: 'Orc' };
  const CLASSES = { Guerrero: 'Warrior', Guerrera: 'Warrior', Mago: 'Mage', Maga: 'Mage', Explorador: 'Ranger', Exploradora: 'Ranger' };
  const REGIONS = {
    Andalucía: 'Andalusia', Aragón: 'Aragon', 'Islas Baleares': 'Balearic Islands', Canarias: 'Canary Islands',
    'Castilla y León': 'Castile and León', Cataluña: 'Catalonia', 'Comunidad Valenciana': 'Valencia', Navarra: 'Navarre',
    'País Vasco': 'Basque Country',
  };
  const TITLES = {
    Novato: 'Rookie', Aprendiz: 'Apprentice', Erudito: 'Scholar', Sabio: 'Sage', 'Maestro del saber': 'Master of Knowledge',
    'Gran sabio': 'Grand Sage', 'Leyenda viva': 'Living Legend', Inmortal: 'Immortal', 'Héroe de Alejandría': 'Hero of Alexandria',
    'Guardián del Bosque': 'Forest Guardian', 'Señor de la Forja': 'Lord of the Forge', 'Hijo del Tambor': 'Child of the Drum',
    'Vencedor del Olvido': 'Conqueror of Oblivion',
  };
  const DICT = {
    'Conectando…': 'Connecting…',
    'Buscando rivales…': 'Finding opponents…',
    de: 'of',
    jugadores: 'players',
    'Si no aparece nadie, completaremos la partida con bots.': "If nobody joins, we'll fill the game with bots.",
    Cancelar: 'Cancel',
    'Otra partida': 'Play again',
    'Volver al inicio': 'Back to menu',
    'Vaya…': 'Oops…',
    '👤 Mi perfil': '👤 Profile',
    '¡Empieza la Conquista!': 'The Conquest begins!',
    'Tu color es el de tu nombre arriba. Cada jugador tiene un castillo con 3 torres.':
      'Your color is the one next to your name at the top. Each player has a castle with 3 towers.',
    'Desempate · aproximación': 'Tiebreaker · closest number',
    Aproximación: 'Closest number',
    'Tu respuesta': 'Your answer',
    Enviar: 'Send',
    'Escribe un número': 'Type a number',
    'Están respondiendo los jugadores en combate…': 'The players in battle are answering…',
    'Respuesta correcta': 'Correct answer',
    'sin respuesta': 'no answer',
    'Las regiones posibles parpadean en amarillo.': 'Regions you can pick blink in yellow.',
    'Espera tu turno.': 'Wait for your turn.',
    'Tú miras este combate. ¡Piensa la respuesta!': "You're watching this battle. Think of the answer!",
    'Resultado del combate': 'Battle result',
    '¡Los dos aciertan! Habrá desempate.': 'Both got it right! Tiebreaker coming.',
    'Ninguno acierta.': 'Nobody got it right.',
    '💥 ¡Han tomado tu castillo!': '💥 Your castle has fallen!',
    '¡Te han derribado una torre!': 'You lost a tower!',
    '🏰 ¡Torre derribada!': '🏰 Tower down!',
    '😩 ¡Has perdido una región!': '😩 You lost a region!',
    '⚔️ ¡Conquistada!': '⚔️ Conquered!',
    '🥁 ¡Comienza la batalla!': '🥁 The battle begins!',
    '👆 ¡Elige región!': '👆 Pick a region!',
    '⚔️ ¡Elige a quién atacar!': '⚔️ Choose who to attack!',
    '⚔️ ¡Al ataque!': '⚔️ Attack!',
    '🛡️ ¡Defiéndete!': '🛡️ Defend!',
    '⚔️ ¡Combate!': '⚔️ Battle!',
    '🥇 ¡El más cerca!': '🥇 Closest!',
    '🛡️ ¡Defendida!': '🛡️ Defended!',
    '🤝 ¡Empate en cabeza!': "🤝 It's a tie for first!",
    '👑 ¡Has conquistado España!': '👑 You conquered Spain!',
    'Fin de la partida': 'Game over',
    Eliminado: 'Eliminated',
    'Ha salido': 'Left',
    'Sin conexión': 'Offline',
    'Sin héroe': 'No hero',
    monedas: 'coins',
    'Hoy ya has llegado al tope de monedas': "You've reached today's coin limit",
    Pista: 'Hint',
    Saltar: 'Skip',
    Comodines: 'Power-ups',
    'No te quedan. Consíguelos en la tienda 🪙 →': 'None left.',
    'No se pudo usar el comodín': "Couldn't use the power-up",
    'Conexión perdida. Reconectando…': 'Connection lost. Reconnecting…',
    'Sin respuesta del servidor': 'No response from the server',
    'Partida abierta en otra pestaña': 'Game open in another tab',
    'Sigue jugando en la otra pestaña o dispositivo.': 'Keep playing in the other tab or device.',
    'La partida se ha cortado': 'The game was interrupted',
    'El servidor se ha reiniciado y la partida se ha perdido. ¡Lo sentimos!': 'The server restarted and the game was lost. Sorry!',
    'No se pudo cargar el mapa': "Couldn't load the map",
    'Revisa tu conexión e inténtalo de nuevo.': 'Check your connection and try again.',
    'Mapa de España por comunidades autónomas': 'Map of Spain by region',
    'Sonido apagado: tocar para activar música y efectos': 'Sound off: tap to turn on music and effects',
    'Música y efectos: tocar para quitar la música': 'Music and effects: tap to turn off the music',
    'Solo efectos: tocar para silenciar todo': 'Effects only: tap to mute everything',
    'Ya estás jugando una partida': "You're already in a game",
    'No te quedan comodines de ese tipo. ¡Consíguelos en la tienda!': "You don't have any of that power-up left.",
    'No estás en ninguna partida': "You're not in a game",
    'Ese código no existe o ya no está disponible': "That code doesn't exist or has expired",
    'El servidor está lleno, inténtalo en un rato': 'The server is full, try again in a while',
    'Ya has respondido': "You've already answered",
    'Ahora no se puede usar un comodín': "You can't use a power-up now",
    'Ya has usado ese comodín en esta pregunta': "You've already used that power-up on this question",
    'El 50/50 es para las preguntas con opciones': '50/50 is for multiple-choice questions',
    'La pista es para las preguntas de aproximación': 'The hint is for closest-number questions',
    'Límites: © Instituto Geográfico Nacional de España (CC BY 4.0), vía es-atlas': 'Boundaries: © Instituto Geográfico Nacional de España (CC BY 4.0), via es-atlas',
    ...TIERS,
    ...REGIONS,
    ...TITLES,
  };
  const tr = (s) => (Object.prototype.hasOwnProperty.call(DICT, s) ? DICT[s] : s);
  const pick = (map) => (s) => map[s] || s;
  const PATTERNS = [
    [/^(.*) \(tú\)$/, (m) => `${m[1]} (you)`],
    [/^(.*) \(eliminado\)$/, (m) => `${m[1]} (eliminated)`],
    [/^Tu nivel: (\S+) (\S+)$/, (m) => `Your level: ${m[1]} ${tr(m[2])}`],
    [/^(\S+) (Maestro|Diamante|Platino|Oro|Plata|Bronce)$/, (m) => `${m[1]} ${TIERS[m[2]]}`],
    [/^Si en (\d+) s no aparece nadie más, completaremos la partida con bots\.$/, (m) => `If nobody else joins in ${m[1]} s, we'll fill the game with bots.`],
    [/^💡 Está entre (.+) y (.+)$/, (m) => `💡 It's between ${m[1]} and ${m[2]}`],
    [/^Has respondido (.*)\. Esperando a los demás…$/, (m) => `You answered ${m[1].trim()}. Waiting for the others…`],
    [/^En (.+)$/, (m) => `In ${m[1]}`],
    [/^(.+) elige 2 regiones y (.+) elige 1\.$/, (m) => `${m[1]} picks 2 regions and ${m[2]} picks 1.`],
    [/^👆 Toca en el mapa la región que quieres (ocupar|atacar)$/, (m) => `👆 Tap the region you want to ${m[1] === 'ocupar' ? 'claim' : 'attack'}`],
    [/^(.+) está eligiendo qué (ocupar|atacar)…$/, (m) => `${m[1]} is choosing what to ${m[2] === 'ocupar' ? 'claim' : 'attack'}…`],
    [/^⚔️ (.+) contra (.+)$/, (m) => `⚔️ ${m[1]} vs ${m[2]}`],
    [/^¡(.+) gana el combate!$/, (m) => `${m[1]} wins the battle!`],
    [/^¡(.+) se defiende!$/, (m) => `${m[1]} holds the line!`],
    [/^💥 ¡Cae el castillo de (.+)!$/, (m) => `💥 ${m[1]}'s castle falls!`],
    [/^Has quedado (\d+)º$/, (m) => `You finished #${m[1]}`],
    [/^(\S+) · (\S+)$/, (m) => (RACES[m[1]] || CLASSES[m[2]] ? `${pick(RACES)(m[1])} · ${pick(CLASSES)(m[2])}` : null)],
    [/^Nivel (\d+) · (.+)$/, (m) => `Level ${m[1]} · ${m[2]}`],
    [/^Nivel (\d+) \(máximo\)$/, (m) => `Level ${m[1]} (max)`],
    [/^🎉 ¡Has subido al nivel (\d+)!$/, (m) => `🎉 You reached level ${m[1]}!`],
    [/^🎁 Nuevo: (.+)$/, (m) => `🎁 New: ${m[1]}`],
    [/^Comodín (.+)$/, (m) => `Power-up ${tr(m[1])}`],
    [/^☀️ Incluye \+(\d+) por tu primera partida del día$/, (m) => `☀️ Includes +${m[1]} for your first game of the day`],
  ];

  function translate(text) {
    const key = text.trim();
    if (!key || !/[a-záéíóúñ¿¡]/i.test(key)) return null;
    let out = Object.prototype.hasOwnProperty.call(DICT, key) ? DICT[key] : null;
    if (out === null) {
      for (const [re, fn] of PATTERNS) {
        const m = re.exec(key);
        if (m) {
          out = fn(m);
          if (out !== null) break;
        }
      }
    }
    if (out === null || out === key) return null;
    return text.replace(key, out);
  }

  const ATTRS = ['placeholder', 'aria-label', 'title'];
  function walk(root) {
    if (root.nodeType === 3) {
      const t = translate(root.nodeValue);
      if (t !== null) root.nodeValue = t;
      return;
    }
    if (root.nodeType !== 1) return;
    if (root.tagName === 'SCRIPT' || root.tagName === 'STYLE') return;
    for (const a of ATTRS) {
      const v = root.getAttribute(a);
      if (v) {
        const t = translate(v);
        if (t !== null) root.setAttribute(a, t);
      }
    }
    for (const child of root.childNodes) walk(child);
  }

  function start() {
    document.title = document.title.replace('Conquista', 'Conquest');
    walk(document.body);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') walk(m.target);
        else if (m.type === 'attributes') walk(m.target);
        else for (const n of m.addedNodes) walk(n);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
