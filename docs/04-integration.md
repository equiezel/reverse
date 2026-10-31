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
- Los parametros de maquina se validan al crear el presupuesto; tasas no
  positivas, segundos negativos y valores no finitos lanzan `RangeError`.

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

- `exact`: geometria de diseño (por ejemplo EPS), hay loops cerrados, no hay
  cadenas abiertas y la fuente declara el contorno de pieza.
- `approximate`: hay cadenas abiertas (grabados, lead-outs).
- Un programa CNC basado en centro de herramienta siempre es `approximate`,
  incluso si sus paths cierran: el diametro y los offsets determinan el
  contorno nominal.
- `unusable`: `quotable = false` o no hay loops.

Esto es un tipo compatible para diagnostico, no el `PartGeometry` de CutQuote.
No se debe insertar en el motor actual como geometria exacta: el G-code puede
representar centro de herramienta, entradas, tabs y multipasada; el area
corregida `partAreaMm2` es estimada y no reemplaza un offset geometrico exacto.

## Integracion concreta en Bellari

1. Abrir el repositorio de CutQuote y este prototipo como carpetas separadas en
   un workspace multi-root de VS Code; no copiar archivos todavia.
2. Revisar el flujo de upload, el parser 2D actual, `PartGeometry`, cotizador,
   persistencia y `scripts/verify-engine.ts` en CutQuote.
3. Acordar un contrato pequeño entre proyectos y portar solo los modulos
   necesarios a una feature CNC, manteniendolos sin APIs de Node ni precios.
4. Persistir una version compacta de `QuoteInput`, no el archivo original ni
   todo `analysis` por defecto. Guardar hash, `schemaVersion`, supuestos,
   bloqueos y perfil de maquina.
5. Mostrar las trayectorias y la calidad en un modo CNC separado; no enviar
   `PartGeometryLike` approximate al cotizador 2D existente.
6. Usar G-code para mecanizado/tiempos, EPS para validar contorno si pertenece
   al mismo trabajo y `.art` solo para metadata conocida.
7. Agregar aserciones analiticas de motor y pruebas de importacion/UI en
   CutQuote; recalcular cuando cambie el hash del archivo.

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
8. No se conecto todavia el repositorio CutQuote; esta capa solo entrega datos
   neutrales para presupuesto.
9. El siguiente paso es abrir ambos repositorios en un workspace multi-root y
   mapear los puntos concretos del flujo en CutQuote.
10. Solo despues de ese mapeo se debe implementar y verificar el primer import CNC en la app.
