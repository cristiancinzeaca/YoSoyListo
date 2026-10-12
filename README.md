# Yo Soy Listo — Configuración inicial

Sigue estos pasos EN ORDEN. Todo se puede hacer desde el móvil.

## 1. Subir este código a GitHub

1. Entra en github.com (con tu cuenta ya creada)
2. Botón verde "New" (nuevo repositorio)
3. Nombre: `yosoylisto` → Create repository
4. Dentro del repo vacío, usa "uploading an existing file"
5. Sube TODOS los archivos y carpetas de este proyecto (backend/, admin/, README.md), manteniendo la misma estructura de carpetas
6. Commit changes

(Si el código ya está en GitHub, salta este paso.)

## 2. Crear la base de datos en Supabase

1. Entra en supabase.com → New project
2. Ponle nombre "yosoylisto", elige una contraseña para la base de datos (guárdala)
3. Región: elige una en Europa (más rápido para España)
4. Espera 1-2 minutos a que se cree el proyecto
5. Ve a "SQL Editor" (menú lateral)
6. Ejecuta estos dos archivos, uno detrás de otro y en este orden (para cada uno: "New query", copia y pega el contenido completo y pulsa "Run"):
   1. `backend/db/schema.sql` — crea todas las tablas
   2. `backend/db/seed.sql` — añade 53 preguntas de ejemplo para poder jugar ya (opcional)

## 3. Obtener las claves de Supabase

1. Dentro de tu proyecto Supabase → Settings (engranaje) → API
2. Copia dos valores, los necesitarás en el paso 4:
   - **Project URL** (algo como `https://xxxxx.supabase.co`)
   - **service_role key** (en la sección "Project API keys" — NO la "anon" key, la "service_role")

## 4. Desplegar el backend en Railway

1. Entra en railway.app → New Project
2. "Deploy from GitHub repo" → autoriza acceso a GitHub si te lo pide → elige el repo `yosoylisto`
3. Railway detectará que hay una carpeta `backend/` — si pregunta el "root directory", pon `backend`
4. Ve a la pestaña "Variables" del proyecto en Railway y añade:
   - `SUPABASE_URL` = (el Project URL del paso 3)
   - `SUPABASE_SERVICE_KEY` = (la service_role key del paso 3)
   - `ADMIN_KEY` = una contraseña larga inventada por ti (protege el panel de administración; no la compartas)
5. Railway hará el deploy automáticamente. Cuando termine, en "Settings" → "Networking" → "Generate Domain" para obtener una URL pública (algo como `yosoylisto-backend.up.railway.app`)

## 5. Comprobar que funciona

Abre en el navegador: `https://TU-URL-DE-RAILWAY.up.railway.app/health`

Deberías ver: `{"status":"ok","service":"yosoylisto-backend"}`

Si ves esto, el backend está funcionando.

Ahora abre la URL base (`https://TU-URL-DE-RAILWAY.up.railway.app/`): esa es la web del juego. Pulsa "¡Jugar!" para probar el modo Blitz.

## 6. Conectar el panel de administración

1. Abre `https://TU-URL-DE-RAILWAY.up.railway.app/admin/` (también funciona abriendo el archivo `backend/public/admin/index.html`)
2. En el campo "URL del backend" arriba del todo, pega tu URL de Railway (sin `/health` al final, solo la URL base)
3. En "Clave de administrador" pon el mismo valor que `ADMIN_KEY` en Railway y pulsa "Guardar". Debe aparecer "✓ Conectado"
4. Ya puedes añadir, editar, borrar o importar preguntas (en JSON, hasta 500 de golpe)

## Qué es cada carpeta

- `backend/core/` — servidor principal, conexión a la base de datos, seguridad. No tocar salvo que sepas lo que haces.
- `backend/modules/questions/` — preguntas: tabla, validación, API del panel de administración y preguntas de ejemplo
- `backend/modules/game-blitz/` — modo Blitz: partida individual de 60 segundos con rachas y ranking
- `backend/public/` — la web que ven los jugadores (portada, juego y ranking)
- `backend/test/` — pruebas automáticas (`npm test` dentro de `backend/`)
- `backend/public/admin/` — panel de administración (una sola página HTML)

## Cómo funciona el modo Blitz

- 60 segundos para responder todas las preguntas que puedas (hasta 40 por partida)
- Cada acierto vale 10 puntos; con 3 aciertos seguidos valen x2 y con 6 seguidos, x3
- Un fallo rompe la racha pero no resta puntos
- El servidor comprueba las respuestas y el tiempo: el navegador nunca recibe la respuesta correcta antes de contestar, así que no se puede hacer trampa mirando el código
- Al terminar, el jugador puede guardar su nombre y entrar en el ranking (semanal e histórico)
- Al final se muestran las preguntas falladas con la respuesta correcta (y la explicación, si la pregunta tiene una)

## Próximos pasos

- Más preguntas (lo más importante para que el juego no se repita)
- `auth` — cuentas de jugador
- `economy` — monedas y recompensas
- Modos multijugador (necesitarán matchmaking y WebSockets)
- SEO: páginas indexables por categoría y por pregunta, sitemap
