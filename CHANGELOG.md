# Changelog

Todas las novedades relevantes de DocuDB.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y
el versionado sigue [SemVer](https://semver.org/lang/es/).

## [0.1.0]

Primera versión pública estable del formato en disco **v2**.

### Añadido

- **API compatible con MongoDB**: `updateOne`, `replaceOne`,
  `findOneAndUpdate`, `findOneAndDelete`, `countDocuments`,
  `estimatedDocumentCount`, `distinct`, `aggregate`, `bulkWrite`,
  `createIndexes`, `dropIndexes`.
- **`find(filter, options)`** con `sort`, `skip`, `limit` y `projection`.
  Antes `FindOptions` existía en los tipos pero se ignoraba.
- **Operadores de actualización que antes no hacían nada**: `$push` (con `$each`,
  `$position` y `$slice`), `$addToSet`, `$pull`, `$pop`, `$mul`, `$min`, `$max`.
  Ahora un operador desconocido lanza un error explícito.
- **Índices funcionales**: consultan igualdad, conjuntos (`$in`, `$nin`), rangos
  (`$gt`, `$gte`, `$lt`, `$lte`) y negaciones, con soporte de prefijo para
  índices compuestos. Antes **no se usaban nunca**.
- `explain()` para comprobar el plan de ejecución.
- **Agregación** con `$match`, `$project`, `$group`, `$sort`, `$skip`, `$limit`,
  `$count` y `$unwind`.
- **Ciclo de vida**: `close()`, `flush()`, `stats()`, `compact()`, `backup()`,
  `restore()`, `renameCollection()`, `collectionExists()`.
- **Genéricos por colección**: `db.collection<User>('users')` tipa las
  inserciones y las consultas; `InferSchema` deriva el tipo de un esquema.
- **Validadores asíncronos** mediante `Schema.validateAsync()`.
- **Formato en disco v2**: un archivo por documento, log append-only para el
  orden, metadata de tamaño constante y escrituras atómicas.
- **Migración v1 → v2** con backup, verificación por documento y reporte.
- **Build dual ESM + CJS** con `exports` y tipos por condición.
- **Lock file opcional** (`fileLock`) para impedir que dos procesos abras el
  mismo directorio.
- Opción `compression: 'auto'`, `compressionLevel` y `cacheSize` (caché LRU).
- TypeScript estricto, ESLint, CI en GitHub Actions (Linux y Windows) y
  micro benchmarks reproducibles con `npm run bench`.

### Corregido

- **Los índices no se usaban.** `findByIndex` tenía la condición invertida:
  devolvía `null` cuando el índice existía y desreferenciaba `undefined` cuando
  no. Toda consulta acababa en escaneo completo.
- **`$exists` estaba invertido**: `{ campo: { $exists: false } }` devolvía los
  documentos que **sí** tenían el campo.
- **`_id` duplicado sobrescribía en silencio** y el contador `count()` se
  inflaba. Ahora lanza `DOC010` y el documento rechazado no queda en disco.
- **La caché se devolvía por referencia**: mutar el resultado de `findById`
  modificaba el estado interno. Ahora se devuelven copias defensivas.
- **`dataDir` se ignoraba**: se le añadía un `data/` implícito. Ahora `dataDir`
  es el directorio raíz y la base vive en `<dataDir>/<name>`.
- **`timestamps: true` en la colección no hacía nada**. Ahora añade y mantiene
  `createdAt` / `updatedAt`.
- **`getPosition` rechazaba UUID** aunque la colección usara `idType: 'uuid'`.
- **Los errores perdían su código**: un fallo de esquema o de índice único
  llegaba como `DOC002` genérico. Ahora `DocuDBError` expone `cause` y
  `wrap()` conserva el código original.
- **Lost updates**: el lock se tomaba **después** del read-modify-write. Ahora
  se toma antes y es un mutex FIFO en vez de un *spin-wait* sobre
  `global._documentLocks`.
- **`$in` / `$nin` no comparaban elemento a elemento** en campos array.
- **`strict` por defecto `true`**, lo que rechazaba campos no declarados y
  contradecía los ejemplos del README. Ahora es `false`.
- **Escrituras no atómicas**: un corte de luz podía dejar `_metadata.json` a
  medias. Ahora todo pasa por temporal + `rename`, con serialización por ruta.
- **`drop()` borraba documento por documento**; ahora borra el árbol y los
  índices directamente.
- **La validación de nombres usaba una lista de bloqueo** que rechazaba
  cualquier nombre con punto y nombres como `hosts`. Ahora es una allowlist.
- Se eliminó el `console.error` de la librería.
- Se rellenaron los códigos de error que valían `undefined`.

### Cambiado

- **Rompe**: el formato en disco pasó de v1 a v2. Los directorios existentes
  requieren `db.migrate({ from: 1, to: 2 })`; DocuDB se niega a abrirlos con un
  error `DB015` en lugar de leerlos a medias.
- La versión del paquete pasó de `0.0.0` a `0.1.0`.
- `Schema` y `CollectionOptions.schema` pasan a ser la interfaz
  `SchemaInterface`, para que los tipos no dependan de la clase concreta.
- El paquete se publica con `exports`, así que los imports profundos
  (`docudb/dist/...`) dejan de estar soportados.

### Eliminado

- `.npmignore`, redundante con el campo `files` de `package.json`.
