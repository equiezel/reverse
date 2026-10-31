# Bellari CNC reverse engineering

Lector y analizador de trayectorias CNC para presupuestar mecanizado con la
mayor exactitud posible. Es un prototipo de investigacion independiente del
proyecto Bellari: no es un controlador de maquina ni un parser universal.

## Estado actual

- **G-code de texto**: parser TypeScript modal, IR en mm, operaciones, metricas,
  render SVG y analisis de contornos (loops, agujeros, area, pasadas, entradas).
- **Presupuesto**: `toQuoteInput` devuelve `QuoteInput` con geometria, area de
  pieza, desglose de tiempo, bloqueos y supuestos. No conoce precios.
- **ArtCAM `.art`**: lectura de CFB/OLE2 y metadatos (version, material, espesor,
  toolpaths, herramienta). La geometria de `Data2`/`RampData` sigue sin
  decodificar; el `.art` solo aporta metadatos.
- **EPS**: lector TypeScript puro, con validacion contra el G-code real: mismo
  diseno, 17 subpaths <-> 17 operaciones, perimetro +0.45%, bbox +2r.
- **Corpus real**: cuatro archivos identificados por hash en
  [samples/MANIFEST.md](./samples/MANIFEST.md); los originales se excluyen del
  repositorio.
- **Pruebas**: 50 tests (`npm test`), incluidas las del corpus real cuando
  los samples estan presentes.

El estado y la evidencia por tema estan en [docs/00-corpus.md](./docs/00-corpus.md),
[docs/01-triage.md](./docs/01-triage.md), [docs/02-format-map.md](./docs/02-format-map.md),
[docs/03-validation.md](./docs/03-validation.md), [docs/04-integration.md](./docs/04-integration.md)
y [docs/UNKNOWNS.md](./docs/UNKNOWNS.md). El alcance del parser esta en
[spec/gcode-supported.md](./spec/gcode-supported.md).

## Requisitos y verificaciones

Toolchain usada para validar este estado: Node.js 24.21.0, npm 11.19.0,
TypeScript 5.9.3, tsx 4.23.15, Vitest 3.2.7 y Python 3.13.1.

```powershell
npm ci
npm test
npm run typecheck
```

## CLI

Las rutas de ejemplo usan `samples/`, que esta vacia en clones limpios. Copiar
los originales localmente solo si se tiene permiso; nunca hacer commit de esos
archivos.

```powershell
npm run inspect -- samples\trayectorias.cnc
npm run inspect -- samples\1.eps
npm run dump -- samples\art.art --offset 0 --length 256
npm run dump -- samples\art.art --stream "ArtCAM/VersionInfo/VersionA"
npm run diff -- samples\trayectorias.cnc "samples\1 (1).cnc"
npm run parse -- samples\trayectorias.cnc
npm run parse -- samples\trayectorias.cnc --json --out out\trayectorias.json
npm run render -- samples\trayectorias.cnc --out out\trayectorias.svg
npm run analyze -- samples\trayectorias.cnc
npm run quote -- samples\trayectorias.cnc
npm run quote -- samples\trayectorias.cnc --art samples\art.art --rapid 6000 --efficiency 0.9
npm run quote -- samples\1.eps
npm run validate -- tests\fixtures\rect_100x50_1pass.nc --dxf tests\fixtures\rect_100x50.dxf
npm run validate -- samples\trayectorias.cnc --eps samples\1.eps
```

`validate --eps` compara el bbox del G-code contra el EPS con tolerancia igual
al diametro de herramienta (por defecto 3.5 mm) y reporta el ratio de longitud.
`validate --dxf` acepta DXF ASCII.

## Ejemplo de integracion

```ts
import { detectFormat, parseGcode, parseEps, toQuoteInput, toEpsQuoteInput,
         enrichWithArtcam, probeArtcam } from './src';

const det = detectFormat(bytes);
if (det.kind === 'gcode') {
  let program = parseGcode(text, { filename });
  if (artBytes) program = enrichWithArtcam(program, probeArtcam(artBytes));
  const quote = toQuoteInput(program, { machine: { rapidRateMmMin: 5000 } });
  // quote.quotable, quote.blockers, quote.time, quote.geometry.partAreaMm2
} else if (det.kind === 'postscript') {
  const quote = toEpsQuoteInput(parseEps(text), filename);
  // solo geometria; quote.timeReliable === false
}
```

Ver [docs/04-integration.md](./docs/04-integration.md) para el contrato completo.

## Estructura

- `src/formats/`: deteccion, CFB/ArtCAM, G-code, EPS, metricas, render y DXF.
- `src/analysis/`: cadenas de corte, loops cerrados, anidamiento y areas.
- `src/integration/`: `QuoteInput` y adaptadores hacia Bellari.
- `src/ir/`: tipos neutrales de maquina/precio.
- `tests/fixtures/`: entradas sinteticas, seguras y versionables.
- `tools/cli.ts`: comandos de inspeccion, analisis, presupuesto y validacion.
- `tools/research/`: experimentos de solo lectura y comparaciones no productivas.
- `samples/`: corpus real local, ignorado por Git.

## Restricciones

No ejecutar macros ni software embebido. No subir originales de clientes. El
lector EPS no ejecuta PostScript: interpreta un subconjunto acotado de
operadores. Coverage 1 significa que el parser no encontro bloques desconocidos
segun su modelo; no demuestra que la maquina interprete el programa
identicamente. No cargar un archivo en una maquina real basandose solo en este
prototipo.
