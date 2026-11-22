// Páginas de «Actualidad»: un tema que es noticia esta semana, contado en pocas líneas,
// y un test de cultura general relacionado. Cada página es un JSON en db/actualidad/.
const fs = require('fs');
const path = require('path');
const { layout, esc, shuffledOptions, crumbs, cta, CATS } = require('./pages');

const DIR = path.join(__dirname, '..', '..', 'db', 'actualidad');
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Comprueba un artículo; devuelve la lista de problemas (vacía si está bien).
function problems(a, file) {
  const out = [];
  const need = (cond, msg) => { if (!cond) out.push(msg); };
  need(a && typeof a === 'object', 'no es un objeto');
  if (!out.length) {
    need(SLUG.test(a.slug || ''), 'slug inválido');
    if (file) need(`${a.slug}.json` === file, 'el nombre del archivo no coincide con el slug');
    need(DATE.test(a.date || '') && !Number.isNaN(Date.parse(a.date)), 'date debe ser AAAA-MM-DD');
    for (const k of ['title', 'h1', 'description', 'news']) need(typeof a[k] === 'string' && a[k].trim().length >= 10, `falta ${k}`);
    need(!a.title || a.title.length <= 70, 'title de más de 70 caracteres');
    need(!a.description || (a.description.length >= 70 && a.description.length <= 160), 'description entre 70 y 160 caracteres');
    need(Array.isArray(a.intro) && a.intro.length >= 2 && a.intro.every((p) => typeof p === 'string' && p.length >= 40), 'intro: al menos 2 párrafos');
    need(!a.category || !!CATS[a.category], 'category desconocida');
    need(Array.isArray(a.sources) && a.sources.length >= 1 && a.sources.every((s) => s && typeof s.title === 'string' && /^https:\/\//.test(s.url || '')), 'sources: al menos 1 fuente https');
    const qs = Array.isArray(a.questions) ? a.questions : [];
    need(qs.length >= 8 && qs.length <= 20, 'entre 8 y 20 preguntas');
    const seen = new Set();
    qs.forEach((q, i) => {
      const ok = Array.isArray(q) && typeof q[0] === 'string' && typeof q[1] === 'string' && Array.isArray(q[2]) && q[2].length === 3 && q[2].every((w) => typeof w === 'string' && w.trim());
      need(ok, `pregunta ${i + 1} mal formada`);
      if (!ok) return;
      need(!seen.has(q[0]), `pregunta ${i + 1} repetida`);
      seen.add(q[0]);
      need(new Set([q[1], ...q[2]].map((s) => s.trim().toLowerCase())).size === 4, `pregunta ${i + 1}: opciones repetidas`);
      need([1, 2, 3].includes(q[3]), `pregunta ${i + 1}: dificultad 1, 2 o 3`);
    });
  }
  return out;
}

let cache = null;
function all() {
  if (cache) return cache;
  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.json')) : [];
  cache = files
    .map((f) => {
      const a = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      const errs = problems(a, f);
      if (errs.length) throw new Error(`db/actualidad/${f}: ${errs.join('; ')}`);
      a.questions = a.questions.map(([text, correct, wrong, difficulty, explanation]) => ({ text, correct, wrong, difficulty, explanation }));
      return a;
    })
    .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : x.slug.localeCompare(y.slug)));
  return cache;
}

const bySlug = (slug) => all().find((a) => a.slug === slug) || null;
const fecha = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function indexPage(base) {
  const list = all();
  const cards = list.length
    ? list
        .map((a) => `<a class="card qa-cat-card" href="/actualidad/${a.slug}">
        <strong>${esc(a.h1)}</strong>
        <span>${esc(fecha(a.date))} · ${a.questions.length} preguntas · ${esc(a.description)}</span>
      </a>`)
        .join('\n      ')
    : '<section class="card"><p>Muy pronto, nuevos tests sobre lo que es noticia.</p></section>';
  const body = `    <main>
      <section class="card prose qa-head">
        <h1>Actualidad: tests sobre lo que es noticia</h1>
        <p>Cada semana elegimos los temas de los que todo el mundo habla y preparamos un test de cultura general relacionado. ¿Sabes tanto como crees?</p>
      </section>
      ${cards}
      ${cta(null)}
    </main>`;
  return layout({
    title: 'Tests de actualidad y cultura general · Yo Soy Listo',
    description: 'Tests de cultura general sobre los temas que son noticia esta semana. Preguntas con respuestas, gratis y para jugar desde el móvil.',
    canonical: `${base}/actualidad`,
    body,
    jsonld: [crumbs(base, [['Inicio', '/'], ['Actualidad', '/actualidad']])],
  });
}

function articlePage(base, slug) {
  const a = bySlug(slug);
  const items = a.questions
    .map((q, i) => {
      const opts = shuffledOptions(q).map((o) => `<li>${esc(o)}</li>`).join('');
      const expl = q.explanation ? ` <span class="qa-expl">${esc(q.explanation)}</span>` : '';
      return `<li class="qa-item"><p class="qa-q"><span class="qa-n">${i + 1}.</span> ${esc(q.text)}</p><ol class="qa-opts" type="a">${opts}</ol><details><summary>Ver respuesta</summary><p class="qa-a">✅ <strong>${esc(q.correct)}</strong>.${expl}</p></details></li>`;
    })
    .join('\n');
  const others = all().filter((o) => o.slug !== slug).slice(0, 4);
  const more = others.length
    ? `<section class="card qa-head"><h2>Más tests de actualidad</h2><nav class="qa-cats">${others.map((o) => `<a href="/actualidad/${o.slug}">${esc(o.h1)}</a>`).join('')}</nav></section>`
    : '';
  const cat = a.category && CATS[a.category] ? a.category : null;
  const related = cat ? `<p>¿Te has quedado con ganas? Tienes muchas más <a href="/preguntas/${cat}">${esc(CATS[cat].title.charAt(0).toLowerCase() + CATS[cat].title.slice(1))}</a>.</p>` : '';
  const body = `    <main>
      <article>
      <section class="card prose qa-head">
        <p class="qa-crumbs"><a href="/actualidad">Actualidad</a> › ${esc(fecha(a.date))}</p>
        <h1>${esc(a.h1)}</h1>
        <p class="qa-news"><strong>La noticia:</strong> ${esc(a.news)}</p>
        ${a.intro.map((p) => `<p>${esc(p)}</p>`).join('\n        ')}
      </section>
      <section class="card qa-level"><h2>El test (${a.questions.length} preguntas)</h2><ol class="qa-list">
${items}
</ol></section>
      <section class="card prose qa-head">
        ${related}
        <p class="qa-sources">Fuentes: ${a.sources.map((s) => `<a href="${esc(s.url)}" rel="nofollow noopener" target="_blank">${esc(s.title)}</a>`).join(' · ')}</p>
      </section>
      </article>
      ${more}
      ${cta(cat)}
    </main>`;
  const url = `${base}/actualidad/${a.slug}`;
  return layout({
    title: a.title,
    description: a.description,
    canonical: url,
    body,
    jsonld: [
      crumbs(base, [['Inicio', '/'], ['Actualidad', '/actualidad'], [a.h1, `/actualidad/${a.slug}`]]),
      { '@context': 'https://schema.org', '@type': 'Article', headline: a.h1, description: a.description, datePublished: a.date, dateModified: a.date, inLanguage: 'es', mainEntityOfPage: url, image: `${base}/img/og-image.jpg`, author: { '@type': 'Organization', name: 'Yo Soy Listo', url: `${base}/` }, publisher: { '@type': 'Organization', name: 'Yo Soy Listo', logo: { '@type': 'ImageObject', url: `${base}/img/logo.webp` } } },
      {
        '@context': 'https://schema.org',
        '@type': 'Quiz',
        name: a.h1,
        inLanguage: 'es',
        hasPart: a.questions.map((q) => ({ '@type': 'Question', eduQuestionType: 'Multiple choice', text: q.text, acceptedAnswer: { '@type': 'Answer', text: q.correct }, suggestedAnswer: q.wrong.map((w) => ({ '@type': 'Answer', text: w })) })),
      },
    ],
  });
}

const paths = () => ['/actualidad', ...all().map((a) => `/actualidad/${a.slug}`)];
const lastmodOf = (p) => (p === '/actualidad' ? (all()[0] || {}).date : (bySlug(p.split('/')[2]) || {}).date) || null;

module.exports = { indexPage, articlePage, bySlug, all, paths, lastmodOf, problems };
