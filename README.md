# Yo Soy Listo

Juego de preguntas de cultura general en español, pensado para el móvil:

- **Conquista** (modo estrella, 3 jugadores, al estilo Conquistador/Honfoglaló): un mapa de España por comunidades autónomas y un castillo con 3 torres para cada jugador. Primero se reparte el mapa con preguntas de aproximación (quien más se acerque elige 2 comunidades, el segundo 1); después, en 3 rondas, cada jugador ataca una comunidad vecina: atacante y defensor responden la misma pregunta y, si los dos aciertan, desempata una de aproximación. Si cae un castillo, el atacante se queda con todo el territorio de ese jugador. Si no hay 3 personas en 15 segundos, se completa con bots.
- **Blitz** (solo): 60 segundos, rachas que multiplican puntos, ranking semanal e histórico.
- **Duelo online** (1 contra 1): emparejamiento automático con otro jugador; si nadie aparece en 12 segundos, juegas contra un bot. Ranking ELO.
- **Sala privada** (hasta 8): creas una sala, compartes el código o el enlace y jugáis todos a la vez. Se pueden añadir bots.
- **Perfil sin registro**: solo un nombre. Estadísticas, historial de partidas y ELO.
- **Avisos de errores**: los jugadores marcan preguntas incorrectas y tú las revisas en el panel.
- **Panel de administración** en `/admin/`: añadir, editar, borrar e importar preguntas en bloque.

Todo funciona en Railway: un servidor y una base de datos PostgreSQL (plan Hobby, unos 5 $ al mes).

---

## Ponerlo online (todo desde Railway, sin copiar claves)

El servidor crea solo las tablas y carga las 473 preguntas la primera vez que arranca.

1. Entra en [railway.com](https://railway.com) → **Login** → **GitHub**
2. **New Project** → **Deploy from GitHub repo** → elige `YoSoyListo` (si no aparece, **Configure GitHub App** y dale acceso)
3. Haz clic en el servicio creado → **Settings** → **Root Directory**: `backend`
4. En el lienzo del proyecto: **+ Create** (o **New**) → **Database** → **Add PostgreSQL**
5. Vuelve a hacer clic en el servicio del juego → **Variables** → **New Variable**:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (Railway lo sugiere al escribir; también puedes usar **Add Reference** → Postgres → `DATABASE_URL`)
   - `ADMIN_KEY` = una contraseña larga inventada por ti (para el panel de administración)
6. Si aparece un botón **Deploy** o **Apply changes**, púlsalo
7. **Settings** → **Networking** → **Generate Domain** (si pregunta el puerto, deja el que propone). Esa es la dirección de tu juego
8. (Recomendado) **Settings** → **Deploy** → **Healthcheck Path**: `/health`
9. Deja **1 sola réplica** (lo que viene por defecto): las partidas online viven en la memoria del servidor

En **Deployments** → **View logs** deberías ver «Base de datos lista: 473 preguntas».

<details>
<summary>Alternativa: usar Supabase como base de datos</summary>

En lugar de `DATABASE_URL`, pon `SUPABASE_URL` y `SUPABASE_SERVICE_KEY` (clave service_role) y ejecuta a mano en Supabase → SQL Editor los archivos `backend/db/schema.sql` y después `backend/db/seed.sql`.
</details>

### Comprobar que funciona

- `https://TU-DOMINIO/health` → debe responder `{"status":"ok","service":"yosoylisto-backend"}`
- `https://TU-DOMINIO/` → la web del juego. Prueba un Blitz y un duelo (si estás solo, a los 12 segundos te toca un bot)
- `https://TU-DOMINIO/admin/` → pon tu `ADMIN_KEY` y pulsa **Guardar**. Debe aparecer «✓ Conectado»

### Antes de anunciarlo

- [ ] (Opcional) Cambia el email de contacto de `backend/public/privacidad.html` si creas uno propio para el juego
- [ ] (Opcional) Añade más preguntas (ver abajo): cuantas más haya, menos se repiten
- [ ] (Opcional) Dominio propio: en Railway → **Settings** → **Networking** → **Custom Domain**. Después añade la variable `PUBLIC_URL=https://tudominio.es`
- [ ] (Opcional) Da de alta el dominio en [Google Search Console](https://search.google.com/search-console) y envía `https://tudominio.es/sitemap.xml`

---

## Añadir preguntas

El juego ya trae 473 preguntas con opciones (geografía, historia, ciencia, arte y literatura, deportes y cultura general) y 119 de aproximación para la Conquista (`backend/db/numeric/aproximacion.json`: `[texto, respuesta, unidad, categoría]`). Para añadir más hay dos caminos:

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

**Desde el código**: las preguntas iniciales están en `backend/db/questions/<categoria>.json`. Después de editarlas, ejecuta `npm run seed` (regenera `seed.sql` comprobando que no haya errores ni repetidas) y despliega: al arrancar, el servidor añade solo las preguntas nuevas.

---

## Para desarrolladores

```bash
cd backend
npm install
npm test          # 28 pruebas: preguntas, Blitz, perfiles, duelos, salas, reconexión
cp .env.example .env   # rellena las variables
npm run dev       # http://localhost:3000
```

### Estructura

- `backend/core/` — servidor HTTP, seguridad (cabeceras, límites de peticiones), base de datos (PostgreSQL directo o Supabase) y creación automática de tablas
- `backend/db/` — `schema.sql` (todas las tablas), `questions/` (preguntas iniciales) y `seed.sql` (generado con `npm run seed`)
- `backend/modules/questions/` — preguntas, categorías y avisos de errores
- `backend/modules/game-blitz/` — modo Blitz
- `backend/modules/players/` — perfiles de invitado (nombre + token guardado en el navegador)
- `backend/modules/multiplayer/` — partidas en tiempo real por WebSocket (`/ws`): emparejamiento, salas, bots, ELO
- `backend/modules/conquista/` — modo Conquista: reglas, mapa y bots (el mapa está en `backend/public/map/espana.json`, generado con límites del IGN)
- `backend/public/` — la web (HTML, CSS y JavaScript sin compilación) y el panel `admin/`
- `backend/test/` — pruebas automáticas

### Seguridad

- Las credenciales de la base de datos solo viven en el servidor; si se usa Supabase, todas las tablas tienen RLS activado sin políticas, así que la clave pública no puede leer nada
- El navegador nunca recibe la respuesta correcta antes de contestar; el tiempo y la puntuación los calcula el servidor
- Límites de peticiones por IP y de mensajes por conexión, cabeceras de seguridad (CSP) y fuentes alojadas en el propio servidor (sin Google Fonts)

### Próximas ideas

- Páginas por categoría indexables para SEO
- Retos diarios y logros
- Cuentas con email para no perder el perfil al cambiar de móvil
