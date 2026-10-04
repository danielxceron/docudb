# Contributing a DocuDB

Gracias por querer colaborar. Este documento explica cómo trabajar con el
código.

## Requisitos

- Node.js ≥ 22.15
- npm 10+

## Puesta en marcha

```bash
npm install
npm run verify   # typecheck + lint + tests + build
```

Scripts disponibles:

| Script | Qué hace |
|---|---|
| `npm run typecheck` | `tsc --noEmit` sobre todo el proyecto |
| `npm run lint` | ESLint con la configuración de `package.json` |
| `npm run lint:fix` | ESLint con autofix |
| `npm test` | compila a `dist/` y ejecuta mocha |
| `npm run test:watch` | idem, en modo watch |
| `npm run build` | build dual ESM + CJS + tipos con tsup |
| `npm run bench` | micro benchmarks |
| `npm run verify` | todo lo anterior en orden |

## Estructura

- `src/core/database.ts` — `Database` y `Collection`. Es el archivo más grande
  y el único que conoce el resto de los módulos.
- `src/query/query.ts` — compilación de criterios a predicados.
- `src/index/indexManager.ts` — índices en memoria y snapshots.
- `src/storage/fileStorage.ts` — formato en disco, chunking y gzip.
- `src/migrate/migrate.ts` — migración entre versiones de formato.

Lee [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) antes de tocar el
almacenamiento.

## Reglas del proyecto

1. **Cero dependencias en runtime.** Todo lo que se añada debe estar en
   `devDependencies` y justificarse.
2. **La librería no escribe en la consola.** Usa la opción `logger`.
3. **Toda escritura al disco es atómica.** Pasa por `writeFileAtomic`.
4. **Los errores conservan su código.** Usa `DocuDBError.wrap` en vez de crear
   un error nuevo; el mensaje original debe seguir apareciendo en
   `error.message` para no romper a quien haga `includes()`.
5. **Toda desviación de la semántica de MongoDB se documenta** en el README.

## Tests

- Suite con mocha + chai sobre el JavaScript compilado (`dist/tests`).
- Cada bug corregido debe traer un test de regresión en
  `tests/regression.test.ts` que falle con la implementación anterior.
- Si tocas el motor de consulta, añade el caso a `tests/api.test.ts` o a
  `tests/query_engine.test.ts`.
- Los tests escriben siempre bajo `data/`, que está en `.gitignore`.

## Commits y versión

- Un cambio, un commit, mensajes en imperativo y en español o inglés
  coherente con el historial.
- Los cambios que rompen el formato en disco o la API pública deben subir la
  versión mayor y añadir una entrada en `CHANGELOG.md`.

## Pull requests

1. `npm run verify` en verde.
2. Describe el problema antes de la solución.
3. Si cambia el rendimiento, incluye números de `npm run bench`.
