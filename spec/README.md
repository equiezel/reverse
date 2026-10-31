# Especificaciones binarias (Kaitai Struct)

Cada `.ksy` describe **un stream OLE2** de un `.art` ArtCAM 9.021, no el
contenedor CFB completo. Los offsets son relativos al inicio del stream.

| Archivo | Stream | Confianza | Notas |
|---|---|---|---|
| `artcam-toolpath-list.ksy` | `ArtCAM/ToolpathData/#ToolpathList` | media | un sample; `version` sin confirmar |
| `artcam-material.ksy` | `ArtCAM/Material/MaterialDescription` | media | un sample, ASCII |
| `artcam-material-thickness.ksy` | `ArtCAM/Material/MaterialThickness` | alta (sample) | `f64le` en offset 0 |
| `artcam-version.ksy` | `ArtCAM/VersionInfo/VersionA` | media | UTF-16LE a EOF |
| `artcam-tool-description.ksy` | `.../<id>/Parameters` | media/baja | offset no fijo; se busca el patron |

No hay `.ksy` para `Data2` ni `RampData`: su geometria no esta decodificada y
no se debe inventar un esquema.

## Verificacion

Con Kaitai Struct instalado:

```powershell
ksc --target python spec/artcam-toolpath-list.ksy
```

El parser TypeScript de referencia esta en `src/formats/artcam/probe.ts` y sus
pruebas en `tests/artcam.test.ts`. Cualquier cambio de esquema debe acompanarse
de un sample nuevo; el corpus actual tiene un solo `.art`.
