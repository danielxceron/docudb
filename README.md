# DocuDB

[![npm version](https://img.shields.io/npm/v/docudb.svg)](https://www.npmjs.com/package/docudb)
[![CI](https://img.shields.io/actions/workflow/status/danielxceron/DocuDB/ci.yml?label=CI&style=flat-square)](https://github.com/danielxceron/DocuDB/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE.txt)
[![types](https://img.shields.io/badge/types-TypeScript-3178c6)](https://www.typescriptlang.org/)
[![runtime deps](https://img.shields.io/badge/runtime%20deps-0-success)](#características)
[![node](https://img.shields.io/badge/node-%3E%3D22.15-5FA04E)](https://nodejs.org)

Base de datos documental NoSQL **embebida** para Node.js. API tipo MongoDB, **cero dependencias en runtime**, almacenamiento en archivos locales, escrituras atómicas y formato en disco versionado.

> **TL;DR** — `npm install docudb`, defines un esquema, insertas documentos JSON y los consultas con una sintaxis que ya conoces. Sin servidor, sin `docker-compose`, sin configuración.

---

## Cuándo usar DocuDB

| Úsalo cuando… | No lo uses cuando… |
|---|---|
| Necesitas persistencia **sin infraestructura** | Necesitas varios procesos o servidores escribiendo a la vez |
| Trabajas en **un solo proceso Node.js** | Necesitas réplicas, particionado o alta concurrencia de escrituras |
| El dataset cabe en decenas o cientos de miles de documentos | El dataset pesa varios GB o requiere consultas analíticas |
| Quieres **tipado estático** de tus documentos | Necesitas transacciones distribuidas o alta disponibilidad |
| Estás construyendo un prototipo, CLI o app de escritorio | Necesitas búsqueda de texto completo |

DocuDB es una base de datos **de proceso único**. Lee [Límites y rendimiento](#límites-y-rendimiento) antes de decidir.

---

## Casos de uso

### 1. Aplicaciones de escritorio y CLI (offline por diseño)
Electron, Tauri, extensiones de VS Code o cualquier CLI necesitan guardar preferencias, caché o estado sin depender de un servidor. DocuDB escribe en el directorio de datos del usuario y funciona sin red.

```typescript
const db = new Database({ name: 'app', dataDir: userDataDir })
const settings = db.collection('settings', { schema: settingsSchema })
await settings.updateById('theme', { $set: { value: 'dark' } })
```

### 2. Prototipos y MVP en minutos
Sustituye a SQLite o a un MongoDB en docker-compose mientras validas la idea. Migrar más adelante es reescribir la capa de acceso.

### 3. Pruebas automatizadas sin mocks ni contenedores
Cada suite levanta su base de datos en un directorio temporal: sin Docker, sin bases compartidas, sin estado residual.

```typescript
beforeEach(async () => {
  const db = new Database({ name: 'test', dataDir: await mkdtemp(join(tmpdir(), 'db-')) })
  await db.initialize()
  users = db.collection<User>('users', { schema: userSchema })
})
afterEach(async () => db.close())
```

### 4. Patrón outbox: buffering local antes de enviar
Eventos, telemetría o notificaciones se escriben primero en disco y un worker posterior los drena a tu backend. Si el servicio remoto cae, los datos no se pierden.

```typescript
const outbox = db.collection('outbox')
await outbox.insertMany(events)                 // rápido, sin red
setInterval(() => flushToRemote(outbox), 5_000)
```

### 5. Cachés y colas locales de trabajos
Jobs pendientes, resultados de cómputos, feature flags o respuestas memoizadas: todo con consulta por índice en vez de un `Map` en memoria que se pierde al reiniciar.

### 6. IoT, kioscos y Raspberry Pi
Sin servidor de base de datos en el campo, sin dependencias del sistema, y con un formato de archivos que puedes respaldar con `tar` o `rsync`.

### 7. Educación: implementar una base de datos desde cero
Chunking, índices, compresión, esquemas de validación, control de concurrencia y un motor de consultas tipo MongoDB en unas 4 000 líneas de TypeScript legible.

### 8. Configuración versionable
Guarda ajustes, feature flags o datos de referencia en archivos versionables con Git y con diffs legibles.

### 9. Apps personales
Notas, recetas, finanzas, biblioteca o registros de hábitos: datos estructurados con validación, sin administración, sin cuenta ni nube.

### 10. Offline-first y edge
En dispositivos con conectividad intermitente, DocuDB es la capa local; la sincronización con el servidor la implementas tú.

### 11. Staging para ETL
Vaciar transformaciones en una colección intermedia antes de cargarlas en su destino, con validación de esquema y consultas de control.

### 12. Accesorios de servidor y teach storage
Muestra chunking, compresión, índices y concurrencia sin configurar nada externo.

---

## Características

- **Documentos JSON** con `_id` automático estilo Mongo (12 bytes) o **UUID v4**
- **Esquemas** con tipos, requeridos, valores por defecto (incluidos funciones y validadores asíncronos), `transform`, `enum`, `pattern`, `min`/`max`, `minLength`/`maxLength` y validadores personalizados
- **Consultas estilo MongoDB**: `$eq $ne $gt $gte $lt $lte $in $nin $exists $regex $size $all $elemMatch $type` + `$and $or $nor $not`, con notación de puntos
- **Ordenación, salto, límite y proyección** de resultados
- **Índices** simples, compuestos, únicos y sparse, conequality, rangos y conjuntos, más `explain()`
- **Operaciones de lote**: `insertMany`, `bulkWrite`, `updateMany`, `deleteMany`
- **Agregación** con `$match $project $group $sort $skip $limit $count $unwind`
- **Compresión gzip** (`true` / `false` / `'auto'`) y **chunking** automático
- **Escrituras atómicas** (archivo temporal + `rename`) y **migración de formato** verificada
- **TypeScript** de principio a fin, con genéricos por colección
- **ESM y CommonJS**, sin dependencias en runtime

---

## Instalación

```bash
npm install docudb
```

Requiere **Node.js ≥ 22.15**. Funciona con `import` y con `require`.

```typescript
import { Database } from 'docudb'   // ESM
const { Database } = require('docudb') // CommonJS
```

---

## Inicio rápido

```typescript
import { Database, Schema } from 'docudb'

const db = new Database({ name: 'myDatabase', compression: true })
await db.initialize()

const userSchema = new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', required: true, validate: { pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ } },
  age: { type: 'number', default: 0, validate: { min: 0, max: 130 } },
  createdAt: { type: 'date', default: () => new Date() }
})

const users = db.collection('users', { schema: userSchema })

const user = await users.insertOne({ name: 'Ada Lovelace', email: 'ada@example.com', age: 36 })
const adults = await users.find({ age: { $gte: 18 } }, { sort: { age: -1 }, limit: 10 })

await users.updateById(user._id, { $set: { age: 37 } })
await users.deleteById(user._id)

await db.close()   // vacía buffers y libera la base de datos
```

### Tipado por colección

```typescript
interface User { name: string; email: string; age: number }

const users = db.collection<User>('users')
await users.insertOne({ name: 'Ada', email: 'ada@example.com', age: 36 })
const adults = await users.find({ age: { $gte: 18 } })
```

También puedes derivar el tipo de un esquema con `InferSchema<typeof definition>`.

---

## Configuración

### Base de datos

```typescript
const db = new Database({
  name: 'myDatabase',        // nombre lógico (validado contra una allowlist)
  dataDir: './data',         // directorio raíz; la base vive en <dataDir>/<name>
  chunkSize: 1024 * 1024,    // 1 MiB: tamaño máximo por fragmento
  compression: true,         // true | false | 'auto'
  idType: 'mongo',           // 'mongo' | 'uuid'
  cacheSize: 1000,           // documentos en caché LRU
  flushInterval: 0,          // >0 agrupa las escrituras de metadata cada N ms
  fileLock: false,           // true impide que otro proceso abra el directorio
  logger: undefined          // la librería nunca escribe en la consola por su cuenta
})
await db.initialize()
```

### Colección

```typescript
const orders = db.collection('orders', {
  schema: orderSchema,
  idType: 'uuid',
  timestamps: true   // añade createdAt / updatedAt
})
```

### Apagado ordenado

```typescript
await db.flush()   // escribe lo pendiente sin cerrar
await db.close()   // flush + libera timers y el lock file
```

`flushInterval: 0` (por defecto) escribe cada cambio: máxima durabilidad. Con un valor mayor se agrupan las escrituras de metadata, lo que acelera bastante las inserciones masivo; en ese caso **llama siempre a `close()`** al terminar.

---

## Esquemas y validación

```typescript
const productSchema = new Schema({
  name:   { type: 'string', required: true, validate: { minLength: 3, maxLength: 120 } },
  sku:    { type: 'string', required: true, validate: { pattern: /^[A-Z]{3}-\d{5}$/ } },
  price:  { type: 'number', required: true, validate: { min: 0 } },
  status: { type: 'string', default: 'draft', validate: { enum: ['draft', 'active'] } },
  tags:   { type: 'array', default: [] },
  meta:   { type: 'object', default: {} },
  email: {
    type: 'string',
    validate: {
      custom: async (value, doc) => isKnownEmail(value) || `Email inválido en ${doc.name}`
    }
  }
})
```

- `strict: true` (por defecto `false`) rechaza campos no declarados.
- Los `default` pueden ser funciones que reciben el documento: `default: (doc) => ...`.
- Los valores por defecto mutables (`[]`, `{}`) se clonan por documento.
- `validate()` es síncrono; `validateAsync()`.awaita validadores asíncronos. `Collection` usa siempre la versión asíncrona.

### Tipos admitidos

`string`, `number`, `int`, `boolean`, `date`, `object`, `array`, `null`.

---

## Consultas

```typescript
await users.find({})                                  // todos
await users.find({ age: { $gt: 25 } })                // comparadores
await users.find({ tags: 'premium' })                  // un elemento del array
await users.find({ 'address.city': 'Lima' })           // campos anidados
await users.find({ $or: [{ age: { $lt: 18 } }, { vip: true }] })
await users.find({ name: { $regex: '^ada', $options: 'i' } })
await users.find({ 'items': { $elemMatch: { qty: { $gte: 5 } } } })

await users.find({ age: { $gte: 18 } }, {
  sort: { age: -1 },
  skip: 0,
  limit: 20,
  projection: { name: 1, email: 1 }    // solo esos campos (+ _id)
})

await users.findOne({ email: 'ada@example.com' })
await users.findById(id)
await users.countDocuments({ vip: true })
await users.distinct('city')
```

También puedes componer un `Query` a mano y pasarlo a `find()`:

```typescript
import { Query } from 'docudb'

const query = new Query({ age: { $gte: 18 } }).sort({ age: -1 }).limit(10).select(['name'])
await users.find(query)
```

---

## Índices

```typescript
await users.createIndex('email', { unique: true })
await users.createIndex(['lastName', 'firstName'])   // índice compuesto
await users.createIndex('age', { sparse: true })
await users.createIndexes([{ field: 'email' }, { field: 'city' }])

await users.listIndexes()
await users.dropIndex('email')
await users.dropIndexes()
```

Un índice responde igualdad (`$eq`), conjuntos (`$in`, `$nin`), rangos (`$gt`, `$gte`, `$lt`, `$lte`), negaciones (`$ne`, `$nin`) y prefijos de índices compuestos. Se puede comprobar con `explain()`:

```typescript
await users.explain({ email: 'ada@example.com' })
// {
//   usedIndex: true,
//   index: 'users:email',
//   keysScanned: 1,
//   docsFetched: 1,
//   docsExamined: 1,
//   plan: 'IXSCAN users:email'
// }
```

Un índice `unique` lanza `MCO_ERROR.INDEX.UNIQUE_VIOLATION` y **no** deja el documento escrito en disco.

---

## Actualizaciones

```typescript
await users.updateById(id, { $set: { age: 31 } })
await users.updateOne({ email: 'a@b.com' }, { $inc: { logins: 1 } })
await users.updateMany({ status: 'draft' }, { $set: { status: 'active' } })
await users.replaceOne({ email: 'a@b.com' }, { email: 'a@b.com', name: 'Ada' })
await users.findOneAndUpdate({ email: 'a@b.com' }, { $inc: { logins: 1 } })
await users.updateOne({ email: 'nuevo@b.com' }, { $set: { name: 'Nuevo' } }, { upsert: true })
```

Operadores soportados: `$set`, `$unset`, `$inc`, `$mul`, `$min`, `$max`, `$push` (con `$each`, `$position` y `$slice`), `$addToSet`, `$pull`, `$pop` y `$rename`. Cualquier otro operador lanza un error explícito en lugar de ignorarse.

## Borrado

```typescript
await users.deleteById(id)                     // true | false
await users.deleteOne({ status: 'archived' })  // true | false
const n = await users.deleteMany({ vip: false })
const gone = await users.findOneAndDelete({ status: 'archived' })
```

---

## Agregación

```typescript
const result = await orders.aggregate([
  { $match: { status: 'paid' } },
  { $group: { _id: '$customerId', total: { $sum: '$amount' }, orders: { $sum: 1 } } },
  { $sort: { total: -1 } },
  { $limit: 10 }
])
```

Etapas: `$match`, `$project`, `$group`, `$sort`, `$skip`, `$limit`, `$count`, `$unwind`.
Acumuladores: `$sum`, `$avg`, `$min`, `$max`, `$first`, `$last`, `$push`, `$addToSet`, `$count`.

---

## Lotes

```typescript
await products.insertMany([...], { ordered: false })   // continúa tras un fallo

await products.bulkWrite([
  { insertOne: { name: 'Lámpara' } },
  { updateOne: { filter: { name: 'Lámpara' }, update: { $set: { price: 60 } } } },
  { updateMany: { filter: { category: 'hogar' }, update: { $set: { active: true } } } },
  { deleteMany: { filter: { discontinued: true } } }
])
```

---

## Mantenimiento

```typescript
await db.stats()            // métricas por colección
await db.compact()          // compacta el log de orden y los índices
await db.backup('/ruta')    // copia el árbol de la base de datos
await db.restore('/ruta')   // reemplaza el contenido con un backup
await db.listCollections()
await db.renameCollection('products', 'catalog')
await db.dropCollection('catalog')
await db.collectionExists('catalog')
```

---

## Manejo de errores

Todo error es un `DocuDBError` con `code`, `details`, `cause` y `timestamp`. El código original **se conserva** al reenvolver errores, así que puedes reaccionar a la causa real.

```typescript
import { DocuDBError, MCO_ERROR } from 'docudb'

try {
  await users.insertOne({ name: 'X', email: 'no-es-un-email' })
} catch (error) {
  if (DocuDBError.isDocuDBError(error)) {
    console.error(error.code)     // p. ej. MCO_ERROR.SCHEMA.INVALID_REGEX
    console.error(error.details)   // campo, valor, patrón esperado
    console.error(error.cause)     // error original
  }
}
```

| Código | Significado |
|---|---|
| `DB011` | Base de datos no inicializada |
| `DB014` | Base de datos cerrada |
| `DB015` | Formato en disco no soportado (falta migrar) |
| `DOC002` | Error al insertar |
| `DOC010` | `_id` duplicado |
| `SCH002` | Campo requerido ausente |
| `SCH003` | Tipo inválido |
| `SCH005` | Campo no permitido en modo estricto |
| `SCH006` | Falló un validador personalizado |
| `IDX004` | Violación de índice único |
| `QUE001` | Operador de consulta inválido |
| `QUE003` | Etapa de agregación no soportada |

La lista completa vive en `MCO_ERROR`.

---

## Límites y rendimiento

DocuDB prioriza **claridad y cero infraestructura** sobre throughput. Números medidos con `npm run bench` en Windows, Node 22+, documentos pequeños (~120 B) con gzip:

| Operación | 10 000 documentos |
|---|---|
| Lectura indexada (`find({ name })`) | **~1,4 ms** |
| Lectura indexada por rango (`find({ n: { $gte } })`) | **~2,4 ms** |
| Escaneo completo (`find({ group })` sin índice) | ~7 900 ms |
| `insertMany` de 10 000 (write-through) | ~20 s |
| `insertMany` de 10 000 (`flushInterval: 25`) | ~24 s |
| Espacio en disco (10 000 docs, gzip) | ~1,6 MB |

Conclusión práctica: **crea un índice para todo campo por el que filtres**. El salto entre escaneo e índice es de tres a cuatro órdenes de magnitud.

Otros límites conocidos:

- **Un solo proceso.** Dos procesos sobre el mismo directorio corrompen datos; activa `fileLock: true` si necesitas que DocuDB lo impida con un error claro.
- **Sin transacciones.** Las operaciones multi-documento no son atómicas: usa operaciones idempotentes o el patrón outbox.
- **Escala bien hasta ~10⁵–10⁶ documentos pequeños.** Más allá, evalúa un motor dedicado.
- **Una consulta sin índice lee todos los documentos** de la colección; añade índices o usa `find` por `_id`.
- DocuDB no cifra los datos en reposo.

---

## Migración de formato

El formato en disco v1 (un directorio por documento) se migra de forma explícita y verificada:

```typescript
const db = new Database({ name: 'myDatabase', dataDir: './data' })
await db.migrate({ from: 1, to: 2, backup: true })
```

La migración copia, **verifica** el contenido de cada documento y solo entonces retira el formato anterior. Con `backup: true` (por defecto) se copia antes el árbol a `data.bak-<timestamp>/`. Al abrir un directorio v1 sin migrar, DocuDB lanza `DB015` en lugar de leerlo a medias.

### Layout actual (v2)

```
data/
├── _format.json                    # versión del formato
└── myDatabase/
    ├── _database.json
    └── users/
        ├── _metadata.json          # contador, índices, nextSeq (tamaño constante)
        ├── _order.log              # log append-only con el orden de inserción
        ├── _indices/email.idx      # snapshot de índice
        └── docs/
            ├── 6a1f….json.gz      # un archivo por documento
            └── 6a2e….part-0000.json.gz   # varios si supera chunkSize
```

---

## Seguridad

- Los nombres de base de datos y colecciones se validan contra una **allowlist** (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`), se rechazan los nombres reservados de Windows y se verifica que la ruta resuelta quede dentro del directorio permitido.
- Las escrituras son **atómicas**: un corte de luz no deja metadata a medio escribir.
- Las consultas se compilan a predicados: no hay `eval` ni inyección de código.
- **DocuDB no cifra los datos.** Si necesitas cifrado en reposo, cifra los valores desde tu aplicación con `transform` en el esquema.

---

## Roadmap

- [ ] Transacciones y operaciones multi-documento atómicas
- [ ] Motor de almacenamiento enchufable (LMDB / SQLite) para datasets mayores
- [ ] Búsqueda de texto completo
- [ ] Replicación y modo de solo lectura

Consulta [CHANGELOG.md](CHANGELOG.md) para el historial.

---

## Contribución

```bash
npm install
npm run verify   # typecheck + lint + tests + build
npm run bench    # micro benchmarks
```

Lee [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) y [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Licencia

[MIT](LICENSE.txt)
