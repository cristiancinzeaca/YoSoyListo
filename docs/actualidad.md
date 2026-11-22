# Páginas de «Actualidad»

Cada página es un JSON en `backend/db/actualidad/<slug>.json`. Se sirve en `/actualidad/<slug>`, aparece en `/actualidad` y entra sola en el sitemap con su fecha.

## Formato

```json
{
  "slug": "minusculas-con-guiones",          // = nombre del archivo
  "date": "AAAA-MM-DD",                       // fecha de publicación
  "category": "geografia",                    // general|historia|geografia|ciencia|arte|deportes (opcional)
  "title": "≤ 70 caracteres, con la palabra clave al principio",
  "h1": "Titular de la página",
  "description": "70–160 caracteres",
  "news": "La noticia en 2–3 frases, con fecha y datos verificados",
  "intro": ["párrafo 1 (≥ 40 caracteres)", "párrafo 2"],
  "sources": [{ "title": "Medio: tema", "url": "https://..." }],
  "questions": [["¿Pregunta?", "Correcta", ["Mal 1", "Mal 2", "Mal 3"], 1, "Explicación opcional o null"]]
}
```

8–20 preguntas, dificultad 1 (fácil), 2 (media) o 3 (difícil). `npm test` valida todos los archivos.

## Criterios editoriales

- Tema con mucha conversación esta semana en España y con un ángulo de cultura general (geografía, historia, ciencia, arte, deporte, cine, música).
- **Nunca**: política de partidos o elecciones, tragedias con víctimas, sucesos, migración, religión, salud de personas concretas, polémicas sobre personas privadas o menores.
- Todo con palabras propias: no copiar frases de los medios. Las fuentes se citan al final.
- Cada dato de la noticia y cada respuesta, comprobados en al menos una fuente fiable. Si hay duda, se quita la pregunta.
- La mitad de las preguntas, como mínimo, deben ser cultura general «perenne» (que siga valiendo dentro de un año), no solo datos de la noticia.
- No repetir un tema ya publicado (mirar `db/actualidad/`).
