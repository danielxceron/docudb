# Security Policy

> 🇬🇧 [English](#english) · 🇪🇸 [Español](#español)

Both versions have the same validity: if they ever disagree, the Spanish text is
the reference for Spanish speakers and the English text is the reference for
everyone else.

---

<a id="español"></a>

## Español

### Versiones soportadas

| Versión | Soporte |
|---|---|
| 0.1.x | ✅ |

### Reportar una vulnerabilidad

**No abras un issue público.** Envía un reporte privado a
<danielxceron@users.noreply.github.com> o usa el formulario *Report a
vulnerability* de Security Advisories del repositorio.

Incluye:

- Descripción del problema y del impacto.
- Versión de DocuDB y de Node.js.
- Pasos para reproducirlo, idealmente un caso mínimo con la API pública.
- Si es posible, una propuesta de mitigación.

Reconfirmamos la recepción en 72 horas, publicamos una mitigación o un parche
en 14 días y coordinamos la divulgación con quien reporta.

### Qué está fuera de alcance

- **DocuDB no cifra los datos en reposo.** Si necesitas cifrado, cifra los
  valores desde tu aplicación.
- **DocuDB no es un motor multi-proceso.** Dos procesos escribiendo sobre el
  mismo directorio pueden corromper los datos. Activa `fileLock: true` para que
  la biblioteca lo impida con un error claro.
- **No hay aislamiento entre consultas.** Cualquier código con acceso a la
  instancia de `Database` puede leer y escribir los datos; no es un mecanismo de
  seguridad frente a código no confiable.
- **Denegación de servicio por consultas completas.** Un `find()` sin índice
  lee toda la colección. Si expones DocuDB a entradas no confiables, aplica
  límites en tu propia capa.

### Buenas prácticas

- Valida la entrada con un `Schema`; las consultas se compilan a predicados, pero
  los campos mal tipados siguen siendo tu responsabilidad.
- No construyas filtros a partir de entrada de usuario sin validar: un filtro
  con operadores desconocidos sí genera error, pero uno mal formado puede
  ejecutarse con una semántica inesperada.
- Usa `flushInterval: 0` (por defecto) si necesitas durabilidad estricta, y
  llama siempre a `db.close()` al terminar.
- Mantén el directorio de datos con permisos restrictivos: contiene datos en
  claro.

---

<a id="english"></a>

## English

### Supported versions

| Version | Supported |
|---|---|
| 0.1.x | ✅ |

### Reporting a vulnerability

**Do not open a public issue.** Send a private report to
<danielxceron@users.noreply.github.com> or use the *Report a vulnerability*
form of the repository's Security Advisories.

Include:

- Description of the problem and its impact.
- DocuDB and Node.js versions.
- Steps to reproduce it, ideally a minimal case using the public API.
- If possible, a mitigation proposal.

We acknowledge receipt within 72 hours, publish a mitigation or a patch within
14 days, and coordinate disclosure with the reporter.

### Out of scope

- **DocuDB does not encrypt data at rest.** If you need encryption, encrypt
  values from your application.
- **DocuDB is not a multi-process engine.** Two processes writing to the same
  directory can corrupt data. Enable `fileLock: true` so the library prevents it
  with a clear error.
- **There is no isolation between queries.** Any code with access to the
  `Database` instance can read and write the data; it is not a security boundary
  against untrusted code.
- **Denial of service through full queries.** A `find()` without an index reads
  the whole collection. If you expose DocuDB to untrusted input, apply limits in
  your own layer.

### Good practices

- Validate input with a `Schema`; queries are compiled into predicates, but
  wrongly typed fields remain your responsibility.
- Do not build filters from unvalidated user input: a filter with an unknown
  operator does raise an error, but a malformed one may still run with
  unexpected semantics.
- Use `flushInterval: 0` (the default) if you need strict durability, and always
  call `db.close()` when you are done.
- Keep the data directory with restrictive permissions: it contains
  plaintext data.