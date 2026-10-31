# 04 - Integracion con Bellari / CutQuote

## Arquitectura

Tres capas, con una sola dependencia hacia abajo:

```
archivo -> detect -> parser (G-code | EPS | ART) -> CncProgram / EpsDocument
                                                   |
                                                   v
                                    analysis/contours (loops, area, nesting)
                                                   |
                                                   v
                                    integration/quote -> QuoteInput
                                                   |
                                                   v
                                          capa comercial (precios)
```

1. **Detectar por firma**, no por extension (`detectFormat`).
2. **Parsear** a `CncProgram` (mm, movimientos ordenados, operaciones,
   warnings, coverage) o a `EpsDocument`.
3. **Analizar** contornos: cadenas, loops cerrados, anidamiento, area barrida,
   area de pieza, pasadas y tipo de entrada.
4. **Adaptar** a `QuoteInput`: magnitudes fisicas + desglose de tiempo +
   bloqueos + supuestos. Esta capa no conoce precios.
5. **Cotizar** en Bellari: la capa comercial aplica tarifas por minuto, mm,
   perforacion, area o pieza.

Todo lo exportado por `src/index.ts` es TypeScript puro y corre en navegador:
no usa `fs`, `path`, `crypto` ni `eval`, y nunca ejecuta el contenido del
archivo (el EPS se interpreta como subconjunto acotado, no como PostScript).

## Contrato `QuoteInput`

```ts
import { detectFormat, parseGcode, parseEps, enrichWithArtcam, probeArtcam,
         toQuoteInput, toEpsQuoteInput, toPartGeometryLike } from './src';

const det = detectFormat(bytes);
if (det.kind === 'gcode') {
  let program = parseGcode(text, { filename });
  if (artBytes) program = enrichWithArtcam(program, probeArtcam(artBytes));
  const quote = toQuoteInput(program, {
    machine: { rapidRateMmMin: 5000, toolChangeSeconds: 10, efficiency: 0.9 },
  });
  if (!quote.quotable) showBlockers(quote.blockers, quote.warnings);
  if (!quote.timeReliable) showAsEstimate(quote.time.reliability);
} else if (det.kind === 'postscript') {
  const quote = toEpsQuoteInput(parseEps(text), filename);
  // solo geometria: quote.kind === 'design-geometry', tiempo no confiable
}
```

Campos principales:

| Campo | Significado |
|---|---|
| `kind` | `machining-program` (G-code) o `design-geometry` (EPS) |
| `geometry.contourLengthMm` | perimetro de contornos cerrados, **una pasada** |
| `geometry.openLengthMm` | cadenas abiertas (grabados), una pasada |
| `geometry.loopCount` / `holeCount` | loops cerrados / agujeros por anidamiento |
| `geometry.netAreaMm2` | area barrida por el eje (top view) |
| `geometry.partAreaMm2` | area de pieza; descuenta `r * perimetro` si hay diametro |
| `geometry.areaBasis` | `tool-center`, `part-contour` o `unknown` |
| `geometry.bboxAreaMm2` | area del bounding box (nesting / chapa) |
| `machining.cutLengthMm` | longitud 3D de todos los avances, todas las pasadas |
| `machining.passes` | niveles de profundidad con corte lateral |
| `machining.partVolumeMm3` | `partArea * thickness` si se conoce el espesor |
| `machining.tool` | primer toolpath con diametro y tipo |
| `operations[]` | desglose por operacion: loops, agujeros, perimetro, longitudes, perforaciones y tiempo |
| `time.*` | corte, entradas, rapido, dwell, cambios, husillo, total |
| `time.reliability` | `estimated` o `incomplete` |
| `quotable` | geometria confiable (coverage 1 y sin blockers) |
| `timeReliable` | el total de tiempo se puede usar como base de precio |
| `blockers` | codigos que impiden cotizar la geometria |
| `assumptions` | supuestos legibles para mostrar al cotizador |
| `analysis` | cadenas completas para render/diagnostico |

`coverage` y `quotable` son independientes de `timeReliable`: un EPS es
cotizable geometricamente pero no tiene tiempo. La UI debe mostrar ambos
estados, no un unico semaforo.

## Desglose de tiempo

```
motionSeconds = (cutSeconds + rapidSeconds) * efficiency
totalSeconds  = motionSeconds + dwellSeconds + toolChangeSeconds + spindleSeconds
```

- `cutSeconds` sale de la longitud 3D de cada movimiento / su `F`.
- `cuttingSeconds` es la porcion bajo material; `entrySeconds` son rampas y
  aproximaciones sobre z=0.
- `rapidSeconds` usa `rapidRateMmMin` porque el programa no declara la velocidad
  real de G0.
- `efficiency` (0..1) corrige aceleraciones y look-ahead. Por defecto 1.
- `spindleStartSeconds` y `toolChangeSeconds` son parametros de maquina.

Si falta `F`, o hay G95 sin RPM, `timeReliable = false` y el total no debe
usarse como precio sin revisar. La geometria sigue siendo valida.

## Politica de bloqueo

| Situacion | `quotable` | `timeReliable` | Accion |
|---|---|---|---|
| G-code completo | true | true | cotizar |
| G-code sin G20/G21 | true (supuesto) | true | mostrar `UNITS_ASSUMED` |
| G41/G42, G53, G43/G44, G92, G desconocido | false | true | pedir reexport o revision |
| Falta `F` o G95 sin RPM | true | false | cotizar geometria; tiempo manual |
| EPS | true si hay loops | false | geometria/area; tiempo no |
| `.art` solo | false | false | pedir G-code/DXF/EPS |

Los avisos llevan `block: 'geometry' | 'time' | 'none'`, de modo que la UI puede
distinguir "no puedo cotizar" de "puedo cotizar pero el tiempo es estimado".

## Conversion opcional a `PartGeometry`

`toPartGeometryLike(quote)` devuelve loops y cadenas abiertas con `quality`:

- `exact`: geometria confiable, hay loops cerrados y no hay cadenas abiertas.
- `approximate`: hay cadenas abiertas (grabados, lead-outs).
- `unusable`: `quotable = false` o no hay loops.

No se debe usar como `PartGeometry` sin mostrar `quality`: el G-code representa
el centro de herramienta, con entradas, tabs y multipasada; el area de pieza se
estima con `partAreaMm2`, no con el area de los loops.

## Integracion concreta en Bellari

1. Copiar `src/ir`, `src/formats`, `src/analysis`, `src/integration` y
   `src/index.ts` al proyecto (sin dependencias externas).
2. Persistir el `QuoteInput` completo, no el archivo original, con
   `schemaVersion: '1'` para poder migrar.
3. Guardar junto al presupuesto: hash del archivo, `source.filename`,
   `assumptions`, `blockers` y `machine`.
4. Mostrar el desglose de tiempo y los supuestos al cotizador; el precio unitario
   y el catalogo quedan en Bellari.
5. Si el usuario adjunta G-code + `.art` + EPS, usar los tres: G-code para
   tiempo, EPS para verificar contorno/area, `.art` para herramienta/espesor.
6. No reutilizar el resultado si cambia el archivo: recalcular y comparar hash.

## Riesgos y esfuerzo

| Entregable | Esfuerzo | Bloqueos |
|---|---|---|
| Importar G-code con dialecto identificado | M | falta productor/controlador/post |
| Vista 2D de trayectorias | M | validar orden, rapidos, arcos y Z |
| Tiempo CNC comercial defendible | M | calibrar feed/rapid/cambios con la maquina |
| Area de pieza defendible | M | compensacion escalar ya implementada; falta offset real |
| Importar EPS en runtime TypeScript | hecho | validado contra el G-code real |
| Importar geometria de toolpaths `.art` | L/indeterminado | `Data2`/`RampData` sin decodificar |
| Reconstruir solido 3D | L | fuera de alcance: el objetivo es cotizar |

## Criterios antes de integrar

1. Confirmar unidades y convencion de Z (el corpus ya cierra: mm, Z negativo).
2. Validar feed/rapid/time contra un simulador o el control real.
3. Asegurar cobertura de todos los comandos del dialecto observado.
4. Probar el parser en el navegador objetivo (sin APIs de Node).
5. Definir que se muestra cuando `timeReliable = false`.
6. Mantener la barrera de bloqueo cuando la semantica no se entiende.

## Resumen de fase

1. El IR, el analisis de contornos y el adaptador `QuoteInput` existen.
2. El parser no depende del precio ni del catalogo.
3. EPS ya tiene lector TypeScript y validacion contra el G-code.
4. El `.art` aporta herramienta y espesor; su geometria sigue sin decodificar.
5. `toPartGeometryLike` es opcional y declara su calidad.
6. La geometria es cotizable; el tiempo es estimado y se marca como tal.
7. Falta calibrar tiempos contra la maquina real.
8. Siguiente paso: definir tarifas en Bellari y consumir `QuoteInput`.
