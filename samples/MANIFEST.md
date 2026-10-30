# Manifiesto de muestras

Los archivos reales **no** se versionan (ver `.gitignore`). Este manifiesto
registra su identidad para que cualquiera pueda verificar que analiza el mismo
corpus. Las rutas y nombres de cliente se redactan en la documentación.

| Archivo | Bytes | SHA-256 | Tipo detectado |
|---|---:|---|---|
| `samples/trayectorias.cnc` | 56 671 | `147dace03d3c6565a45db11cc6912800059ea70f0ab451ac382e6f52a6ca06a3` | G-code texto (Mach2/3) |
| `samples/1 (1).cnc` | 56 671 | `2e16c06f7bad194facc8eed69a56682fd915ab875774182ddb997772fb8b3dfa` | G-code texto (Mach2/3) |
| `samples/art.art` | 227 328 | `6867001f35bc673b629dbfcb2a1b68f2d53a263b74558ec9eb083af64035aa1e` | OLE2/CFB — ArtCAM 9.021 |
| `samples/1.eps` | 41 317 | `fefc775e0346f096a93bc97430cb82984debcf2f582bae8321a1874cff3319d8` | EPS/PostScript |

## Procedencia

- Los cuatro archivos llegaron juntos, en una sola carpeta, sin DXF/SVG de
  control ni documentación del proveedor.
- El usuario recuerda ArtCAM 9 como origen de los `.cnc` y supone que el
  controlador podria ser Mach2; esta informacion aun no fue verificada.
- El nombre `1 (1).cnc` sugiere una descarga duplicada, pero no lo prueba. El
  hash es distinto; los dos archivos contienen las mismas metricas de corte y
  operaciones en distinto orden (ver `docs/03-validation.md`).
- `art.art` es un proyecto ArtCAM 9.021 con dos toolpaths y herramienta
  `3.17mm plana`.
- `1.eps` es una exportacion vectorial ArtCAM asociada al grupo de archivos.
  No se ha demostrado que sus contornos correspondan al G-code; ver
  `docs/03-validation.md`, seccion EPS.
- No hay NDA, pero se redactan nombres de cliente, rutas y cualquier dato
  identificatorio.

## Cómo regenerar este manifiesto

```powershell
Get-FileHash samples/trayectorias.cnc,"samples/1 (1).cnc",samples/art.art,samples/1.eps -Algorithm SHA256
```
