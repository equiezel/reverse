# Bellari CNC reverse engineering

Prototipo de investigacion para identificar archivos CAM/CNC y extraer
trayectorias y metricas sin depender del proyecto Bellari. No es un controlador
de maquina ni un parser universal.

## Estado actual

- G-code de texto: parser TypeScript modal, IR en mm, metricas y SVG.
- ArtCAM `.art`: lectura de CFB/OLE2 y metadatos de material/toolpaths; la
  geometria de los toolpaths sigue sin decodificar y no es cotizable.
- EPS: identificacion y scripts de analisis en Python; no hay parser EPS del
  runtime TypeScript ni una comparacion geometrica aprobada con el G-code.
- Corpus sintetico: aserciones analiticas de G-code y DXF; fixture rectangular
  validado contra su DXF con diferencia de longitud y bbox igual a cero.
- Corpus real: cuatro archivos identificados por hash en
  [samples/MANIFEST.md](./samples/MANIFEST.md); los originales se excluyen del
  repositorio.

El estado y la evidencia por tema estan en [docs/00-corpus.md](./docs/00-corpus.md),
[docs/01-triage.md](./docs/01-triage.md), [docs/02-format-map.md](./docs/02-format-map.md),
[docs/03-validation.md](./docs/03-validation.md), [docs/04-integration.md](./docs/04-integration.md)
y [docs/UNKNOWNS.md](./docs/UNKNOWNS.md). El alcance detallado del parser esta en
[spec/gcode-supported.md](./spec/gcode-supported.md).

## Requisitos y verificaciones

Toolchain usada para validar este estado: Node.js 24.21.0, npm 11.19.0,
TypeScript 5.9.3, tsx 4.23.15, Vitest 3.2.7 y Python 3.13.1. El proyecto no
declara una version minima de Node; verificar compatibilidad antes de bajar la
version.

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
npm run dump -- samples\art.art --offset 0 --length 256
npm run dump -- samples\art.art --stream "ArtCAM/VersionInfo/VersionA"
npm run diff -- samples\trayectorias.cnc "samples\1 (1).cnc"
npm run parse -- samples\trayectorias.cnc
npm run parse -- samples\trayectorias.cnc --json --out out\trayectorias.json
npm run render -- samples\trayectorias.cnc --out out\trayectorias.svg
npm run validate -- tests\fixtures\rect_100x50_1pass.nc --dxf tests\fixtures\rect_100x50.dxf
```

`validate --dxf` acepta DXF ASCII, no EPS. El validador compara longitud total y
bbox; no alinea contornos ni certifica que las trayectorias sean del mismo
diseño. Para investigacion EPS existen scripts Python en `tools/research/`;
no son parte del runtime final.

## Estructura

- `src/formats/`: deteccion, CFB/ArtCAM, G-code, metricas, render y lector DXF.
- `src/ir/`: tipos neutrales de maquina/precio.
- `tests/fixtures/`: entradas sinteticas, seguras y versionables.
- `tools/cli.ts`: comandos de inspeccion, parseo y validacion.
- `tools/research/`: experimentos de solo lectura y comparaciones no productivas.
- `samples/`: corpus real local, ignorado por Git.

## Restricciones

No ejecutar macros ni software embebido. No subir originales de clientes.
Coverage 1 significa que el parser no encontro bloques desconocidos segun su
modelo; no demuestra que la maquina interprete el programa identicamente. No
cargar un archivo en una maquina real basandose solo en este prototipo.
