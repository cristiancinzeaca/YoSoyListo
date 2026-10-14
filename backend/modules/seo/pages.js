// Páginas públicas para Google: preguntas con respuestas por categoría (/preguntas y /preguntas/:cat).
// Se generan en el servidor a partir de db/questions/*.json, sin JavaScript (las respuestas van en <details>).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'db', 'questions');

const CATS = {
  general: {
    name: 'Cultura general',
    title: 'Preguntas de cultura general con respuestas',
    desc: 'Preguntas de cultura general con respuestas: fáciles, medias y difíciles. Pon a prueba lo que sabes y juega gratis contra otros jugadores.',
    intro:
      'Aquí tienes preguntas de cultura general con sus respuestas: costumbres, animales, idiomas, marcas, fiestas, números y curiosidades del día a día. Las hemos ordenado de más fáciles a más difíciles para que puedas usarlas en un trivial con amigos, en clase o para repasar. Toca «Ver respuesta» para comprobar si has acertado.',
  },
  historia: {
    name: 'Historia',
    title: 'Preguntas de historia con respuestas',
    desc: 'Preguntas de historia de España y del mundo con respuestas: de la Antigüedad a nuestros días. Juega gratis y demuestra cuánto sabes.',
    intro:
      'Preguntas de historia con respuestas, de la Antigüedad a nuestros días: Roma y Grecia, la Edad Media, la historia de España, las guerras mundiales y los grandes personajes. Son perfectas para repasar antes de un examen o para retar a tu familia. Toca «Ver respuesta» para comprobar si has acertado.',
  },
  geografia: {
    name: 'Geografía',
    title: 'Preguntas de geografía con respuestas',
    desc: 'Preguntas de geografía con respuestas: capitales, ríos, montañas, países y comunidades de España. Juega gratis a conquistar el mapa.',
    intro:
      'Preguntas de geografía con respuestas: capitales del mundo, ríos, montañas, monumentos famosos y las comunidades y provincias de España. Empiezan por las más fáciles y terminan con algunas que solo aciertan los más viajeros. Toca «Ver respuesta» para comprobar si has acertado.',
  },
  ciencia: {
    name: 'Ciencia',
    title: 'Preguntas de ciencia con respuestas',
    desc: 'Preguntas de ciencia con respuestas: cuerpo humano, química, física, astronomía, animales y matemáticas. Juega gratis y aprende jugando.',
    intro:
      'Preguntas de ciencia con respuestas sobre el cuerpo humano, la química, la física, el espacio, los animales y las matemáticas. Muchas incluyen una breve explicación para que aprendas algo nuevo aunque falles. Toca «Ver respuesta» para comprobar si has acertado.',
  },
  arte: {
    name: 'Arte y literatura',
    title: 'Preguntas de arte, literatura, cine y música con respuestas',
    desc: 'Preguntas de arte, literatura, cine y música con respuestas: pintores, escritores, películas, series y canciones. Juega gratis.',
    intro:
      'Preguntas de arte, literatura, cine y música con respuestas: pintores y museos, escritores y novelas, películas, series, dibujos animados y grupos míticos. Hay desde preguntas que sabe cualquiera hasta otras para auténticos expertos. Toca «Ver respuesta» para comprobar si has acertado.',
  },
  deportes: {
    name: 'Deportes',
    title: 'Preguntas de deportes con respuestas',
    desc: 'Preguntas de deportes con respuestas: fútbol, baloncesto, tenis, Fórmula 1, Juegos Olímpicos y más. Juega gratis contra otros jugadores.',
    intro:
      'Preguntas de deportes con respuestas: fútbol, baloncesto, tenis, ciclismo, Fórmula 1, motociclismo y Juegos Olímpicos, con especial atención a los deportistas españoles. Toca «Ver respuesta» para comprobar si has acertado.',
  },
};
const ORDER = ['general', 'historia', 'geografia', 'ciencia', 'arte', 'deportes'];
const LEVELS = { 1: 'Preguntas fáciles', 2: 'Preguntas de dificultad media', 3: 'Preguntas difíciles' };

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Orden fijo de las opciones (para que la correcta no sea siempre la primera y la página no cambie).
function shuffledOptions(q) {
  const opts = [q.correct, ...q.wrong];
  const seed = crypto.createHash('md5').update(q.text).digest();
  for (let i = opts.length - 1; i > 0; i--) {
    const j = seed[i] % (i + 1);
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  return opts;
}

let cache = null;
function load() {
  if (cache) return cache;
  cache = {};
  for (const cat of ORDER) {
    const list = JSON.parse(fs.readFileSync(path.join(DIR, `${cat}.json`), 'utf8'));
    cache[cat] = list.map(([text, correct, wrong, difficulty, explanation]) => ({ text, correct, wrong, difficulty: difficulty || 2, explanation }));
  }
  return cache;
}

function layout({ title, description, canonical, body }) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#1b1035">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(canonical)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:image" content="/img/og-image.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/img/favicon-48.png" type="image/png" sizes="48x48">
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div class="container">
    <header class="site-header">
      <a class="logo" href="/" aria-label="Yo Soy Listo · Inicio"><img src="/img/logo.webp" alt="Yo Soy Listo" width="900" height="580"></a>
      <a class="me-chip" href="/">🎮 Jugar</a>
    </header>
${body}
    <footer class="site-footer">© Yo Soy Listo · <a href="/preguntas">Preguntas con respuestas</a> · <a href="/privacidad">Privacidad</a></footer>
  </div>
</body>
</html>`;
}

function catLinks(current) {
  return `<nav class="qa-cats" aria-label="Categorías">${ORDER.map(
    (c) => `<a href="/preguntas/${c}"${c === current ? ' aria-current="page"' : ''}>${esc(CATS[c].name)}</a>`
  ).join('')}</nav>`;
}

function cta(cat) {
  return `<section class="card qa-cta">
      <h2>¿Te atreves a jugar de verdad?</h2>
      <p>En Yo Soy Listo respondes contra el reloj y contra otros jugadores: conquista el mapa de España, reta a un amigo a un duelo o haz el reto diario. Gratis y desde el móvil.</p>
      <a class="btn" href="/blitz${cat ? `?cat=${cat}` : ''}">⚡ Jugar${cat ? ` a ${esc(CATS[cat].name.toLowerCase())}` : ''} (60 segundos)</a>
      <a class="btn btn-secondary" href="/conquista">🏰 Conquistar España</a>
    </section>`;
}

function indexPage(base) {
  const qs = load();
  const total = ORDER.reduce((s, c) => s + qs[c].length, 0);
  const cards = ORDER.map((c) => {
    const sample = qs[c].find((q) => q.difficulty === 1) || qs[c][0];
    return `<a class="card qa-cat-card" href="/preguntas/${c}">
        <strong>${esc(CATS[c].title)}</strong>
        <span>${qs[c].length} preguntas · Ej.: «${esc(sample.text)}»</span>
      </a>`;
  }).join('\n      ');
  const body = `    <main>
      <section class="card prose qa-head">
        <h1>Preguntas de trivial con respuestas</h1>
        <p>Más de ${(Math.floor(total / 100) * 100).toLocaleString('es-ES')} preguntas de cultura general con sus respuestas, divididas por categorías y por dificultad. Úsalas para un trivial con amigos, para clase o para repasar… y cuando estés listo, demuestra lo que sabes jugando online.</p>
      </section>
      ${cards}
      ${cta(null)}
    </main>`;
  return layout({
    title: 'Preguntas de trivial con respuestas por categorías · Yo Soy Listo',
    description: `Más de ${(Math.floor(total / 100) * 100).toLocaleString('es-ES')} preguntas de trivial con respuestas: cultura general, historia, geografía, ciencia, arte y deportes. Gratis.`,
    canonical: `${base}/preguntas`,
    body,
  });
}

function categoryPage(base, cat) {
  const info = CATS[cat];
  const list = load()[cat];
  let n = 0;
  const sections = [1, 2, 3]
    .map((level) => {
      const qs = list.filter((q) => q.difficulty === level);
      if (!qs.length) return '';
      const items = qs
        .map((q) => {
          n += 1;
          const opts = shuffledOptions(q)
            .map((o) => `<li>${esc(o)}</li>`)
            .join('');
          const expl = q.explanation ? ` <span class="qa-expl">${esc(q.explanation)}</span>` : '';
          return `<li class="qa-item"><p class="qa-q"><span class="qa-n">${n}.</span> ${esc(q.text)}</p><ol class="qa-opts" type="a">${opts}</ol><details><summary>Ver respuesta</summary><p class="qa-a">✅ <strong>${esc(q.correct)}</strong>.${expl}</p></details></li>`;
        })
        .join('\n');
      return `<section class="card qa-level"><h2>${LEVELS[level]} (${qs.length})</h2><ol class="qa-list">\n${items}\n</ol></section>`;
    })
    .join('\n');
  const body = `    <main>
      <section class="card prose qa-head">
        <p class="qa-crumbs"><a href="/preguntas">Preguntas con respuestas</a> › ${esc(info.name)}</p>
        <h1>${esc(info.title)}</h1>
        <p>${esc(info.intro)}</p>
        ${catLinks(cat)}
      </section>
      ${sections}
      ${cta(cat)}
    </main>`;
  return layout({
    title: `${info.title} (${list.length}) · Yo Soy Listo`,
    description: info.desc,
    canonical: `${base}/preguntas/${cat}`,
    body,
  });
}

const SEO_PATHS = ['/preguntas', ...ORDER.map((c) => `/preguntas/${c}`)];

module.exports = { indexPage, categoryPage, CATS, ORDER, SEO_PATHS };
