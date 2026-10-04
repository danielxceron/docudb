# Arquitectura

> 🇬🇧 [English](ARCHITECTURE.md) · 🇪🇸 **Español**

> Este archivo es la traducción. La versión de referencia es
> [`ARCHITECTURE.md`](ARCHITECTURE.md).

DocuDB es una base de datos documental NoSQL **embebida** para Node.js: API
tipo MongoDB, cero dependencias en runtime y almacenamiento en archivos
locales.

## Arquitectura en una página

```
┌──────────────────────────────────────────────────────────────┐
│ index.ts                     API pública (ESM + CJS + tipos)  │
├──────────────────────────────────────────────────────────────┤
│ src/core/database.ts         Database + Collection            │
│   ├─ Collection<T>           CRUD, lotes, posiciones, stats   │
│   └─ Database                ciclo de vida, backup, migración │
├──────────────────────────────────────────────────────────────┤
│ src/query/query.ts           compilador de criterios → predicado│
│ src/aggregation/aggregate.ts pipeline $match…$unwind           │
│ src/schema/schema.ts         validación declarativa            │
├──────────────────────────────────────────────────────────────┤
│ src/index/indexManager.ts    índices en memoria + snapshots   │
│ src/storage/fileStorage.ts   formato v2 en disco + gzip       │
│ src/compression/gzip.ts      zlib                              │
├──────────────────────────────────────────────────────────────┤
│ src/utils/*                  rutas, atajos de I/O, mutex, UUID │
│ src/errors/errors.ts         MCO_ERROR + DocuDBError           │
│ src/types/index.ts           contrato de tipos                 │
└──────────────────────────────────────────────────────────────┘
```

## Formato en disco (v2)

```
data/
├── _format.json                          # { formatVersion: 2 }
└── <db>/
    ├── _database.json
    └── <collection>/
        ├── _metadata.json                # count, nextSeq, indices — tamaño constante
        ├── _order.log                    # log append-only: {s,i} | {d} | {o}
        ├── _indices/<field>[+field].idx   # snapshot de índice
        └── docs/<id>.json[.gz]            # un archivo por documento
            <id>.part-NNNN.json[.gz]       # N archivos si supera chunkSize
```

Cuatro decisiones explican el rendimiento actual:

1. **Un archivo por documento en lugar de un directorio con N archivos.**
   Un directorio más un archivo por documento costaba dos entradas de sistema de
   archivos por documento; ahora cuesta una.

2. **Metadata de tamaño constante.** El orden de inserción **no** se guarda como
   un array en `_metadata.json` (eso hacía que cada insert reescribiera un
   archivo O(n), convirtiendo una carga de 10 000 documentos en O(n²)). Se guarda
   en `_order.log`, un log append-only: insertar cuesta un `append`.

3. **Escrituras atómicas.** Todo archivo se escribe como temporal + `rename`, y
   las escrituras al mismo destino se serializan con un mutex por ruta. En
   Windows `rename` sobre un archivo abierto por otro handle falla con `EPERM`,
   así que el rename además reintenta ante errores transitorios.

4. **Índices con mapa inverso.** Un índice es
   `Map<valueKey, Set<docId>>` más `Map<docId, Set<valueKey>>`. Quitar un
   documento del índice es O(claves de ese documento) en lugar de recorrer todas
   las claves del índice. Los snapshots se escriben de forma diferida (bandera de
   sucio + `flushInterval`), nunca en cada escritura.

## Concurrencia

- **Dentro de un proceso**: `KeyedMutex` (`src/utils/mutex.ts`) serializa las
  operaciones por documento con una cadena de promesas FIFO. El lock se toma
  **antes** de leer, no después, lo que elimina la ventana de *lost update*.
  Antes se usaba un `global._documentLocks` con *spin-wait* y `setTimeout`, que
  además colisionaba entre bases de datos distintas.
- **Entre procesos**: opcional mediante `fileLock: true`, que toma un `_lock`
  con `open(path, 'wx')` y detecta procesos muertos.

## Motor de consulta

`compileCriteria()` recorre el árbol de criterios **una vez** y devuelve un
closure. Antes se re-interpretaba el árbol por cada documento. Los predicados
operan sobre los valores del documento mediante `getNestedValue`, con notación
de puntos y soporte de índices numéricos de array.

`sort` usa un orden total explícito (`undefined < null < boolean < number <
string < Date < array < object`) para que ordenar nunca devuelva un orden
arbitrario cuando faltan campos.

## Búsqueda con índices

`Collection._findWithOptimization()` busca un campo del criterio con índice,
delega en `IndexManager.lookup()` y después re-verifica el predicado completo
sobre los candidatos. Soporta igualdad, conjuntos, rangos y negaciones; los
índices compuestos se consultan por prefijo. `explain()` expone el plan para
poder verificar en tests que el índice se está usando.

## Versionado del formato

`FORMAT_VERSION` vive en `src/types/index.ts`. Al abrir una base de datos:

- Directorio vacío → se adopta la versión actual.
- Manifiesto con versión mayor → error `DB015`.
- Manifiesto con versión menor (o directorios con documentos v1) → error `DB015`
  indicando que hay que migrar.

`migrateDatabase()` implementa v1 → v2: lee cada documento con el lector v1, lo
escribe con el escritor v2, lo relee y compara; solo después borra el formato
anterior. Con `backup: true` copia antes el árbol completo.

## Puntos de extensión

- `Schema` acepta validadores `custom` asíncronos (`validateAsync`).
- `logger` permite recibir diagnósticos sin que la librería escriba en la consola.
- `compression: 'auto'` decide por tamaño, y `compressionLevel` ajusta gzip.
- `KeyedMutex`, `deepCopy` y los ayudantes de rutas se exportan por si quieres
  reutilizarlos.
