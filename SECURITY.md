# Política de seguridad

## Versiones soportadas

| Versión | Soporte |
|---|---|
| 0.1.x | ✅ |

## Reportar una vulnerabilidad

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

## Qué está fuera de alcance

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

## Buenas prácticas

- Valida la entrada con un `Schema`; las consultas se compilan a predicados, pero
  los campos mal tipados siguen siendo tu responsabilidad.
- No construyas filtros a partir de entrada de usuario sin validar: un filtro
  con operadores desconocidos sí genera error, pero uno mal formado puede
  ejecutarse con una semántica inesperada.
- Usa `flushInterval: 0` (por defecto) si necesitas durabilidad estricta, y
  llama siempre a `db.close()` al terminar.
- Mantén el directorio de datos con permisos restrictivos: contiene datos en
  claro.
