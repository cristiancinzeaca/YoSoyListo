# Yo Soy Listo

Juego de preguntas de cultura general en español, pensado para el móvil:

- **Blitz** (solo): 60 segundos, rachas que multiplican puntos, ranking semanal e histórico.
- **Duelo online** (1 contra 1): emparejamiento automático con otro jugador; si nadie aparece en 12 segundos, juegas contra un bot. Ranking ELO.
- **Sala privada** (hasta 8): creas una sala, compartes el código o el enlace y jugáis todos a la vez. Se pueden añadir bots.
- **Perfil sin registro**: solo un nombre. Estadísticas, historial de partidas y ELO.
- **Avisos de errores**: los jugadores marcan preguntas incorrectas y tú las revisas en el panel.
- **Panel de administración** en `/admin/`: añadir, editar, borrar e importar preguntas en bloque.

Todo funciona con un solo servidor (Railway) y una base de datos (Supabase), ambos con plan gratuito para empezar.

---

## Ponerlo online (paso a paso, se puede hacer desde el móvil)

### 1. Base de datos en Supabase

1. Entra en [supabase.com](https://supabase.com) → **New project**
2. Nombre `yosoylisto`, inventa una contraseña para la base de datos (guárdala) y elige una región de **Europa**
3. Espera 1-2 minutos a que se cree
4. Menú lateral → **SQL Editor** → **New query**. Copia y pega **todo** el contenido de [`backend/db/schema.sql`](backend/db/schema.sql) y pulsa **Run**
5. Otra **New query** con [`backend/db/seed.sql`](backend/db/seed.sql) → **Run** (473 preguntas en 6 categorías para poder jugar desde el primer día)
6. **Project Settings** (engranaje) → **API**. Copia:
   - **Project URL** (algo como `https://xxxxx.supabase.co`)
   - la clave **service_role** (¡no la `anon`!). Es secreta: no la pegues en ningún sitio público.

Los dos archivos SQL se pueden volver a ejecutar sin problema (no borran ni duplican nada). Cuando haya cambios en la base de datos en el futuro, basta con ejecutar de nuevo `schema.sql`.

### 2. Servidor en Railway

1. Entra en [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → elige `yosoylisto`
2. En el servicio → **Settings** → **Root Directory**: `backend`
3. Pestaña **Variables** → añade:
   - `SUPABASE_URL` = la Project URL
   - `SUPABASE_SERVICE_KEY` = la clave service_role
   - `ADMIN_KEY` = una contraseña larga inventada por ti (para el panel de administración)
4. **Settings** → **Networking** → **Generate Domain**. Esa es la dirección de tu juego (algo como `yosoylisto.up.railway.app`)
5. Deja **1 sola réplica** (es lo que viene por defecto): las partidas online viven en la memoria del servidor
6. (Recomendado) **Settings** → **Deploy** → **Healthcheck Path**: `/health`. Así Railway no cambia a una versión nueva hasta que esté funcionando

Railway vuelve a desplegar solo cada vez que cambia la rama principal en GitHub.

### 3. Comprobar que funciona

- `https://TU-DOMINIO/health` → debe responder `{"status":"ok","service":"yosoylisto-backend"}`
- `https://TU-DOMINIO/` → la web del juego. Prueba un Blitz y un duelo (si estás solo, a los 12 segundos te toca un bot)
- `https://TU-DOMINIO/admin/` → pon tu `ADMIN_KEY` y pulsa **Guardar**. Debe aparecer «✓ Conectado»

### 4. Antes de anunciarlo

- [ ] (Opcional) Cambia el email de contacto de `backend/public/privacidad.html` si creas uno propio para el juego
- [ ] (Opcional) Añade más preguntas (ver abajo): cuantas más haya, menos se repiten
- [ ] (Opcional) Dominio propio: en Railway → **Settings** → **Networking** → **Custom Domain**. Después añade la variable `PUBLIC_URL=https://tudominio.es`
- [ ] (Opcional) Da de alta el dominio en [Google Search Console](https://search.google.com/search-console) y envía `https://tudominio.es/sitemap.xml`

---

## Añadir preguntas

El juego ya trae 473 preguntas (geografía, historia, ciencia, arte y literatura, deportes y cultura general). Para añadir más hay dos caminos:

**Desde el panel** (lo más fácil):

En `/admin/` → **Importar varias preguntas (JSON)**, pega una lista con este formato (hasta 500 cada vez):

```json
[
  {
    "text": "¿Cuál es la capital de Francia?",
    "options": ["París", "Roma", "Berlín", "Madrid"],
    "correctIndex": 0,
    "category": "geografia",
    "difficulty": 1,
    "explanation": "París es la capital de Francia desde el siglo X."
  }
]
```

- `correctIndex`: posición de la respuesta correcta, empezando en 0
- `category`: `geografia`, `historia`, `ciencia`, `arte`, `deportes`, `general` (o una nueva: aparecerá sola en los selectores)
- `difficulty`: 1 fácil, 2 media, 3 difícil
- `explanation`: opcional; se muestra al jugador cuando falla

**Desde el código**: las preguntas iniciales están en `backend/db/questions/<categoria>.json`. Después de editarlas, ejecuta `npm run seed` (regenera `seed.sql` comprobando que no haya errores ni repetidas) y vuelve a ejecutar `seed.sql` en Supabase: solo añade las nuevas.

---

## Para desarrolladores

```bash
cd backend
npm install
npm test          # 23 pruebas: preguntas, Blitz, perfiles, duelos, salas, reconexión
cp .env.example .env   # rellena las variables
npm run dev       # http://localhost:3000
```

### Estructura

- `backend/core/` — servidor HTTP, seguridad (cabeceras, límites de peticiones), conexión a Supabase
- `backend/db/` — `schema.sql` (todas las tablas), `questions/` (preguntas iniciales) y `seed.sql` (generado con `npm run seed`)
- `backend/modules/questions/` — preguntas, categorías y avisos de errores
- `backend/modules/game-blitz/` — modo Blitz
- `backend/modules/players/` — perfiles de invitado (nombre + token guardado en el navegador)
- `backend/modules/multiplayer/` — partidas en tiempo real por WebSocket (`/ws`): emparejamiento, salas, bots, ELO
- `backend/public/` — la web (HTML, CSS y JavaScript sin compilación) y el panel `admin/`
- `backend/test/` — pruebas automáticas

### Seguridad

- La clave service_role solo vive en el servidor; todas las tablas tienen RLS activado sin políticas, así que la clave pública no puede leer nada
- El navegador nunca recibe la respuesta correcta antes de contestar; el tiempo y la puntuación los calcula el servidor
- Límites de peticiones por IP y de mensajes por conexión, cabeceras de seguridad (CSP) y fuentes alojadas en el propio servidor (sin Google Fonts)

### Próximas ideas

- Páginas por categoría indexables para SEO
- Retos diarios y logros
- Cuentas con email para no perder el perfil al cambiar de móvil
