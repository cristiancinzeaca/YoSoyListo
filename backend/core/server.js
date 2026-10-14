const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { errorHandler } = require('./http');
const { getDb } = require('./db');
const { migrate } = require('./migrate');
const questionsRoutes = require('../modules/questions/routes');
const blitzRoutes = require('../modules/game-blitz/routes');
const playersRoutes = require('../modules/players/routes');
const shopRoutes = require('../modules/shop/routes');
const authRoutes = require('../modules/auth/routes');
const countriesRoutes = require('../modules/countries/routes');
const chatRoutes = require('../modules/chat/routes');
const heroesRoutes = require('../modules/heroes/routes');
const campaignRoutes = require('../modules/campaign/routes');
const dailyRoutes = require('../modules/daily/routes');
const weeklyRoutes = require('../modules/weekly/routes');
const weekly = require('../modules/weekly/service');
const chat = require('../modules/chat/service');
const seoPages = require('../modules/seo/pages');
const { attachMultiplayer } = require('../modules/multiplayer/hub');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;

// Páginas que queremos que Google indexe.
const SITEMAP_PAGES = ['/', '/reto', '/conquista', '/mundo', '/campana', '/privacidad', ...seoPages.SEO_PATHS];

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Railway pone un proxy delante: así req.ip es la IP real del jugador.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'", (req) => `wss://${req.get('host')}`, (req) => `ws://${req.get('host')}`],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: isProduction ? [] : null,
        },
      },
      // El panel de administración se puede abrir desde otro sitio (o desde un archivo).
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );
  app.use(compression());
  app.use('/api', cors());
  app.use(express.json({ limit: '1mb' }));

  // Con dominio propio, la dirección antigua de Railway manda a la nueva (una sola copia para Google).
  app.use((req, res, next) => {
    const target = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/+$/, '') : '';
    const host = (req.get('host') || '').toLowerCase();
    if (!target || !host.endsWith('.up.railway.app') || target.includes(host)) return next();
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path === '/health' || req.path.startsWith('/api/')) return next();
    res.redirect(301, target + req.originalUrl);
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'yosoylisto-backend' });
  });

  app.use('/api/questions', questionsRoutes);
  app.use('/api/blitz', blitzRoutes);
  app.use('/api/players', playersRoutes);
  app.use('/api/shop', shopRoutes);
  app.use('/api/auth', authRoutes.api);
  app.use('/api/countries', countriesRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/heroes', heroesRoutes);
  app.use('/api/campaign', campaignRoutes);
  app.use('/api/daily', dailyRoutes);
  app.use('/api/weekly', weeklyRoutes);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  app.use('/auth', authRoutes.pages);

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(
      ['User-agent: *', 'Disallow: /admin/', 'Disallow: /api/', 'Disallow: /pareja', 'Disallow: /auth/', '', `Sitemap: ${baseUrl(req)}/sitemap.xml`, ''].join('\n')
    );
  });

  app.get('/sitemap.xml', (req, res) => {
    const base = baseUrl(req);
    const urls = SITEMAP_PAGES.map((p) => `  <url><loc>${base}${p}</loc></url>`).join('\n');
    res
      .type('application/xml')
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  });

  // Preguntas con respuestas (para Google).
  app.get('/preguntas', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600').type('html').send(seoPages.indexPage(baseUrl(req)));
  });
  app.get('/preguntas/:cat', (req, res, next) => {
    if (!seoPages.CATS[req.params.cat]) return next();
    res.set('Cache-Control', 'public, max-age=3600').type('html').send(seoPages.categoryPage(baseUrl(req), req.params.cat));
  });

  // Duelos y salas usan la misma página; el código de sala va en ?c=XXXXX.
  app.get(['/conquista', '/pareja'], (req, res) => {
    res.set('Cache-Control', 'no-cache').sendFile(path.join(PUBLIC_DIR, 'conquista.html'));
  });

  app.get(['/duelo', '/sala'], (req, res) => {
    res.set('Cache-Control', 'no-cache').sendFile(path.join(PUBLIC_DIR, 'online.html'));
  });

  // Web pública del juego (carpeta public/).
  app.use(
    express.static(PUBLIC_DIR, {
      extensions: ['html'],
      maxAge: '1h',
      setHeaders(res, filePath) {
        // El HTML siempre fresco, para que los cambios se vean al momento.
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        if (filePath.endsWith('.woff2')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    })
  );

  app.use((req, res) => {
    res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
  });

  app.use(errorHandler);
  return app;
}

// Servidor HTTP + partidas en red por WebSocket en el mismo puerto.
function createServer(deps) {
  const server = http.createServer(createApp());
  const multiplayer = attachMultiplayer(server, deps);
  server.multiplayer = multiplayer;
  return server;
}

if (require.main === module) {
  if (!process.env.ADMIN_KEY) console.warn('⚠️  Falta la variable ADMIN_KEY: el panel de administración no funcionará');
  if (!process.env.DATABASE_URL && !(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)) {
    console.warn('⚠️  Falta la base de datos: añade DATABASE_URL (o SUPABASE_URL y SUPABASE_SERVICE_KEY)');
  }
  const port = Number(process.env.PORT) || 3000;
  const server = createServer();

  (async () => {
    // Con PostgreSQL directo, las tablas y las preguntas se crean solas al arrancar.
    if (process.env.DATABASE_URL) {
      try {
        const total = await migrate(getDb().pool);
        console.log(`Base de datos lista: ${total} preguntas`);
        // Los mensajes viejos del chat se borran solos (cada 6 horas).
        chat.prune();
        setInterval(() => chat.prune(), 6 * 3600_000).unref();
        // Premios de la liga semanal: se comprueba al arrancar y cada hora.
        const settle = () => weekly.settle().catch((e) => console.error('[liga] reparto', e.message));
        settle();
        setInterval(settle, 3600_000).unref();
      } catch (err) {
        console.error('❌ No se pudo preparar la base de datos:', err.message);
      }
    }
    server.listen(port, () => {
      console.log(`Yo Soy Listo escuchando en el puerto ${port}`);
    });
  })();

  // Railway manda SIGTERM al desplegar una versión nueva: cerramos con orden.
  const shutdown = (signal) => {
    console.log(`${signal} recibido, cerrando...`);
    server.multiplayer.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { createApp, createServer };
