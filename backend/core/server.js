const path = require('path');
const express = require('express');
const cors = require('cors');
const { errorHandler } = require('./http');
const questionsRoutes = require('../modules/questions/routes');
const blitzRoutes = require('../modules/game-blitz/routes');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Railway pone un proxy delante: así req.ip es la IP real del jugador.
  app.set('trust proxy', 1);

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'yosoylisto-backend' });
  });

  app.use('/api/questions', questionsRoutes);
  app.use('/api/blitz', blitzRoutes);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  // Web pública del juego (carpeta public/).
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  app.use(errorHandler);
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log(`Yo Soy Listo escuchando en el puerto ${port}`);
  });
}

module.exports = { createApp };
