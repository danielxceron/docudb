# Contributing to DocuDB

> 🇬🇧 [English](#english) · 🇪🇸 [Español](#español)

Both versions have the same validity: if they ever disagree, the Spanish text is
the reference for Spanish speakers and the English text is the reference for
everyone else.

---

<a id="español"></a>

## Español

Gracias por querer colaborar. Este documento explica cómo trabajar con el
código.

### Requisitos

- Node.js ≥ 18
- npm 10+

### Puesta en marcha

```bash
npm install
npm run verify     # typecheck + lint + tests + build
npm run docs:check # verifica que la documentación ES/EN esté sincronizada
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
| `npm run docs:check` | compara la documentación en español y en inglés |
| `npm run bench` | micro benchmarks |
| `npm run verify` | typecheck + lint + tests + docs + build |

### Estructura

- `src/core/database.ts` — `Database` y `Collection`. Es el archivo más grande
  y el único que conoce el resto de los módulos.
- `src/query/query.ts` — compilación de criterios a predicados.
- `src/index/indexManager.ts` — índices en memoria y snapshots.
- `src/storage/fileStorage.ts` — formato en disco, chunking y gzip.
- `src/migrate/migrate.ts` — migración entre versiones de formato.
- `docs/ARCHITECTURE.md` — el diseño y sus decisiones.

Lee [docs/ARCHITECTURE.es.md](docs/ARCHITECTURE.es.md) antes de tocar el
almacenamiento.

### Reglas del proyecto

1. **Cero dependencias en runtime.** Todo lo que se añada debe estar en
   `devDependencies` y justificarse.
2. **La librería no escribe en la consola.** Usa la opción `logger`.
3. **Toda escritura al disco es atómica.** Pasa por `writeFileAtomic`.
4. **Los errores conservan su código.** Usa `DocuDBError.wrap` en vez de crear
   un error nuevo; el mensaje original debe seguir apareciendo en
   `error.message` para no romper a quien haga `includes()`.
5. **Toda desviación de la semántica de MongoDB se documenta** en el README.
6. **La documentación va en los dos idiomas.** Si añades una sección al
   `README.md`, añádela también al `README.es.md`: `npm run docs:check` falla si
   las estructuras dejan de coincidir.

### Tests

- Suite con mocha + chai sobre el JavaScript compilado (`dist/tests`).
- Cada bug corregido debe traer un test de regresión en
  `tests/regression.test.ts` que falle con la implementación anterior.
- Si tocas el motor de consulta, añade el caso a `tests/api.test.ts` o a
  `tests/query_engine.test.ts`.
- Los tests escriben siempre bajo `data/`, que está en `.gitignore`.

### Commits y versión

- Un cambio, un commit, mensajes en imperativo y en español o inglés
  coherente con el historial.
- Los cambios que rompen el formato en disco o la API pública deben subir la
  versión mayor y añadir una entrada en `CHANGELOG.md` **y** en
  `CHANGELOG.es.md`.

### Pull requests

1. `npm run verify` en verde.
2. Describe el problema antes de la solución.
3. Si cambia el rendimiento, incluye números de `npm run bench`.

---

<a id="english"></a>

## English

Thanks for wanting to contribute. This document explains how to work with the
codebase.

### Requirements

- Node.js ≥ 18
- npm 10+

### Getting started

```bash
npm install
npm run verify     # typecheck + lint + tests + build
npm run docs:check # verifies the English/Spanish docs are in sync
```

Available scripts:

| Script | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` over the whole project |
| `npm run lint` | ESLint using the configuration in `package.json` |
| `npm run lint:fix` | ESLint with autofix |
| `npm test` | compiles to `dist/` and runs mocha |
| `npm run test:watch` | same, in watch mode |
| `npm run build` | dual ESM + CJS build with types, via tsup |
| `npm run docs:check` | compares the Spanish and English documentation |
| `npm run bench` | micro benchmarks |
| `npm run verify` | typecheck + lint + tests + docs + build |

### Layout

- `src/core/database.ts` — `Database` and `Collection`. It is the largest file
  and the only one that knows about the other modules.
- `src/query/query.ts` — compilation of criteria into predicates.
- `src/index/indexManager.ts` — in-memory indexes and snapshots.
- `src/storage/fileStorage.ts` — on-disk format, chunking and gzip.
- `src/migrate/migrate.ts` — migration between format versions.
- `docs/ARCHITECTURE.md` — the design and the reasoning behind it.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before touching storage.

### Project rules

1. **Zero runtime dependencies.** Anything you add must go in
   `devDependencies` and be justified.
2. **The library never writes to the console.** Use the `logger` option.
3. **Every disk write is atomic.** Go through `writeFileAtomic`.
4. **Errors keep their code.** Use `DocuDBError.wrap` instead of building a new
   error; the original message must still show up in `error.message` so that
   consumers doing `includes()` keep working.
5. **Any deviation from MongoDB semantics gets documented** in the README.
6. **Documentation ships in both languages.** If you add a section to
   `README.md`, add it to `README.es.md` too: `npm run docs:check` fails when
   the structures stop matching.

### Tests

- Mocha + chai suite running against the compiled JavaScript (`dist/tests`).
- Every fixed bug must come with a regression test in
  `tests/regression.test.ts` that fails against the previous implementation.
- If you touch the query engine, add the case to `tests/api.test.ts` or to
  `tests/query_engine.test.ts`.
- Tests always write under `data/`, which is in `.gitignore`.

### Commits and versioning

- One change, one commit, imperative messages, in whichever language is
  consistent with the history.
- Changes that break the on-disk format or the public API must bump the major
  version and add an entry to `CHANGELOG.md` **and** `CHANGELOG.es.md`.

### Pull requests

1. `npm run verify` is green.
2. Describe the problem before the solution.
3. If performance changes, include numbers from `npm run bench`.