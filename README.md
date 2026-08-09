# Yo Soy Listo — Configuración inicial

Sigue estos pasos EN ORDEN. Todo se puede hacer desde el móvil.

## 1. Subir este código a GitHub

1. Entra en github.com (con tu cuenta ya creada)
2. Botón verde "New" (nuevo repositorio)
3. Nombre: `yosoylisto` → Create repository
4. Dentro del repo vacío, usa "uploading an existing file"
5. Sube TODOS los archivos y carpetas de este proyecto (backend/, admin/, README.md), manteniendo la misma estructura de carpetas
6. Commit changes

## 2. Crear la base de datos en Supabase

1. Entra en supabase.com → New project
2. Ponle nombre "yosoylisto", elige una contraseña para la base de datos (guárdala)
3. Región: elige una en Europa (más rápido para España)
4. Espera 1-2 minutos a que se cree el proyecto
5. Ve a "SQL Editor" (menú lateral)
6. Copia y pega el contenido completo de `backend/modules/questions/schema.sql`
7. Pulsa "Run" — esto crea la tabla de preguntas

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
5. Railway hará el deploy automáticamente. Cuando termine, en "Settings" → "Networking" → "Generate Domain" para obtener una URL pública (algo como `yosoylisto-backend.up.railway.app`)

## 5. Comprobar que funciona

Abre en el navegador: `https://TU-URL-DE-RAILWAY.up.railway.app/health`

Deberías ver: `{"status":"ok","service":"yosoylisto-backend"}`

Si ves esto, el backend está funcionando.

## 6. Conectar el panel de administración

1. Abre el archivo `admin/index.html` — de momento puedes abrirlo directamente desde tu móvil (o subirlo también a algún hosting estático simple más adelante)
2. En el campo "URL del backend" arriba del todo, pega tu URL de Railway (sin `/health` al final, solo la URL base) y pulsa "Guardar"
3. Ya puedes añadir tu primera pregunta desde el formulario

## Qué es cada carpeta

- `backend/core/` — servidor principal, conexión a la base de datos. No tocar salvo que sepas lo que haces.
- `backend/modules/questions/` — todo lo relacionado con las preguntas (primer módulo funcional)
- `backend/modules/[otros]/` — carpetas vacías, preparadas para los próximos módulos (auth, economy, game-blitz, etc.) — se irán rellenando en las siguientes sesiones
- `admin/` — panel de administración (una sola página HTML, sin instalación)

## Próximo paso

Con esto ya puedes empezar a cargar preguntas. El siguiente módulo a construir es `game-blitz` (el modo de juego solo, cronometrado) — no necesita matchmaking ni WebSockets, así que es el más simple para validar que todo el flujo funciona de principio a fin.
