# 01 - Triage e identificacion

Triage reproducible con `npm run inspect -- <archivo>` y el analizador Python
`python tools/research/triage.py <archivo>`. Tamaños y hashes se listan en
[00-corpus.md](./00-corpus.md).

| Archivo | Tipo real | Productor probable | Evidencia | Confianza |
|---|---|---|---|---|
| `trayectorias.cnc` | Texto G-code/RS-274 | Desconocido | Texto imprimible, 2806 bloques con movimientos; comandos G0/G1; hash del manifiesto | Alta para tipo; baja para productor |
| `1 (1).cnc` | Texto G-code/RS-274 | Desconocido | Prefijo `% CRLF G90 CRLF G49 CRLF M3 S18000`, ratio printable 1.0, 2811/2813 lineas no vacias tipo G-code | Alta para tipo; baja para productor |
| `art.art` | MS-CFB/OLE2, proyecto ArtCAM | ArtCAM 9.021 | Firma `D0 CF 11 E0 A1 B1 1A E1`; streams bajo `ArtCAM/`; VersionInfo; 36 streams | Alta |
| `1.eps` | EPS/PostScript | ArtCAM | `%!PS-Adobe-3.0 EPSF-3.0`, `%%Creator: ArtCAM`, `%%Title: Contour data from ArtCAM` | Alta |

El detector de G-code no asigna productor a los `.cnc`; por lo tanto, la etiqueta
Mach2/3 no esta confirmada. La firma de G-code es textual, no una firma binaria.
El prefijo de `1 (1).cnc` se encuentra en el offset 0 del archivo; su fin de
linea es CRLF.

### CFB / ArtCAM

El lector encuentra 50 entradas de directorio bajo `ArtCAM/`, de las cuales 36
son streams. Incluyen `ArtCAM/VersionInfo/VersionA`,
`ArtCAM/Material/MaterialThickness`, `ArtCAM/Material/MaterialDescription`,
`ArtCAM/ToolpathData/#ToolpathList` y, por cada toolpath, `Parameters`,
`Data2` y `RampData`. Los streams `Data2`/`RampData` no son texto interpretable
con el conocimiento actual.

### Comandos

```powershell
npm run inspect -- "1 (1).cnc"
npm run inspect -- art.art
npm run inspect -- 1.eps
python tools\research\triage.py "1 (1).cnc" art.art 1.eps
```

Los originales se examinan localmente; no se ejecutan macros o contenido
embebido. Triage detallado de campos y unknowns:
[02-format-map.md](./02-format-map.md) y [UNKNOWNS.md](./UNKNOWNS.md).

## Resumen de fase

1. Ambos `.cnc` son texto y contienen trayectorias G-code.
2. La deteccion de G-code es de confianza alta por densidad de bloques.
3. El productor de los `.cnc` sigue desconocido.
4. El `.art` tiene firma CFB/OLE2 valida.
5. El `.art` contiene directorios ArtCAM y metadata comprobable.
6. El EPS tiene encabezado y comentarios de productor ArtCAM.
7. El EPS declara escala de mm a PostScript points.
8. No se encontro evidencia que permita ejecutar contenido embebido.
9. No se decodifico la geometria de `Data2`/`RampData`.
10. Siguiente paso: ampliar corpus diferencial y documentar campos binarios estables.
