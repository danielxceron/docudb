# Releasing DocuDB

> 🇬🇧 [English](#english) · 🇪🇸 [Español](#español)

Both versions have the same validity: if they ever disagree, the Spanish text is
the reference for Spanish speakers and the English text is the reference for
everyone else.

---

<a id="español"></a>

## Español

### Reglas de npm que conviene tener presentes

- **Una versión publicada es inmutable.** Si algo sale mal se corrige en la
  siguiente versión, nunca re-publicando la misma.
- Solo se puede despublicar dentro de **72 horas**: `npm unpublish docudb@<v>`.
- `prepublishOnly` ejecuta `npm run verify`, así que no se publica nada sin
  pasar typecheck, lint, los tests, la comprobación de documentación y la de
  empaquetado.

### Checklist

1. **Comprueba el estado del registro**

   ```bash
   npm view docudb versions --json
   ```

   Elige la siguiente versión. Recuerda que `latest` pasa automáticamente a la
   mayor versión sin prefijo.

2. **Actualiza la versión y el changelog**

   ```bash
   npm version 0.1.0        # también crea el tag git v0.1.0
   ```

   Añade la entrada a `CHANGELOG.md` **y** a `CHANGELOG.es.md`. Si el cambio
   rompe el formato en disco o la API, menciónalo como *Breaking* y explica el
   paso a seguir.

3. **Verifica que todo está en verde**

   ```bash
   npm run verify
   ```

4. **Prueba el tarball antes de subirlo**

   ```bash
   npm pack
   # IMPORTANTE: usa un directorio FUERA del repositorio. Si el directorio de
   # prueba queda dentro del repo y no tiene su propio package.json, npm sube
   # por el árbol, encuentra el package.json de DocuDB y registra el tarball
   # como dependencia del propio proyecto.
   SMOKE=$(mktemp -d)
   cd "$SMOKE"
   npm init -y
   npm install "$OLDPWD"/docudb-<version>.tgz
   # prueba import y require con un script pequeño
   cd - && rm -rf "$SMOKE"
   ```

   Descarta errores de empaquetado antes de que lleguen al registro. Si
   olvidaste el directorio externo, `npm run package:check` te avisará de la
   dependencia colada.

5. **Publica en dry-run y luego en serio**

   ```bash
   npm publish --dry-run   # revisa la lista de archivos
   npm publish
   ```

6. **Confirma y sube el tag**

   ```bash
   npm view docudb
   git push origin v0.1.0
   ```

7. **Publica las notas en GitHub Releases**, incluyendo el aviso de
   incompatibilidad si lo hay, y marca el tag desde la interfaz.

### Si algo falla

```bash
npm unpublish docudb@0.1.0   # solo dentro de las primeras 72 horas
```

Después corrige y publica `0.1.1`.

---

<a id="english"></a>

## English

### npm rules worth keeping in mind

- **A published version is immutable.** If something goes wrong you fix it in
  the next version, never by re-publishing the same one.
- You can only unpublish within **72 hours**: `npm unpublish docudb@<v>`.
- `prepublishOnly` runs `npm run verify`, so nothing ships without passing
  typecheck, lint, the tests, the documentation check and the packaging check.

### Checklist

1. **Check the registry state**

   ```bash
   npm view docudb versions --json
   ```

   Pick the next version. Remember that `latest` moves automatically to the
   highest version without a prerelease suffix.

2. **Bump the version and the changelog**

   ```bash
   npm version 0.1.0        # also creates the v0.1.0 git tag
   ```

   Add the entry to `CHANGELOG.md` **and** `CHANGELOG.es.md`. If the change
   breaks the on-disk format or the API, mark it as *Breaking* and explain the
   upgrade step.

3. **Make sure everything is green**

   ```bash
   npm run verify
   ```

4. **Test the tarball before uploading it**

   ```bash
   npm pack
   # IMPORTANT: use a directory OUTSIDE the repository. If the test directory
   # lives inside the repo and has no package.json of its own, npm walks up the
   # tree, finds the DocuDB package.json and records the tarball as a
   # dependency of the project itself.
   SMOKE=$(mktemp -d)
   cd "$SMOKE"
   npm init -y
   npm install "$OLDPWD"/docudb-<version>.tgz
   # try both import and require with a short script
   cd - && rm -rf "$SMOKE"
   ```

   This rules out packaging mistakes before they reach the registry. If you
   forgot the outside directory, `npm run package:check` will point at the
   stray dependency.

5. **Publish as a dry run, then for real**

   ```bash
   npm publish --dry-run   # review the file list
   npm publish
   ```

6. **Confirm and push the tag**

   ```bash
   npm view docudb
   git push origin v0.1.0
   ```

7. **Publish the notes as a GitHub Release**, including the incompatibility
   notice if there is one, and mark the tag from the UI.

### If something fails

```bash
npm unpublish docudb@0.1.0   # only within the first 72 hours
```

Then fix it and publish `0.1.1`.