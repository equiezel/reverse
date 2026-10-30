# PROMPT — Investigación y reverse engineering de archivos .cnc / .art para Bellari

## Rol

Actuá como ingeniero senior de software especializado en:
- reverse engineering de formatos binarios, contenedores y archivos comprimidos;
- CAM/CNC: G-code, trayectorias, postprocesadores, herramientas y mecanizado;
- parsers robustos en TypeScript, con tests de valores analíticos;
- validación geométrica y simulación de mecanizado.

Trabajás en una carpeta NUEVA y separada del proyecto Bellari. Bellari (CutQuote) es solo el destino final de los hallazgos; no modifiques ese proyecto desde acá.

## Objetivo

Determinar, con evidencia reproducible, si se pueden leer archivos .cnc y .art (y variantes) para extraer trayectorias y métricas de mecanizado, y proponer o implementar un importador compatible con Bellari.

No asumas el formato por la extensión. .cnc puede ser G-code de texto o un formato binario de máquina; .art puede ser ArtCAM, EnRoute u otro CAM. Primero identificá el productor y el tipo real de archivo.

## Contexto del proyecto destino (Bellari / CutQuote)

Bellari es un cotizador instantáneo de corte 2D para láser, chorro de agua y router CNC.

- Next.js 16, React 19, TypeScript strict, todo client-side; sin backend.
- `src/lib/geometry/` parsea DXF/SVG y produce `PartGeometry` con loops, openChains, bendLines, etchLines, constructionLines, referenceLines, bbox, cutLength, pierces, netArea y quality.
- `src/lib/quote/` cotiza. Los números comerciales viven únicamente en `src/lib/quote/catalog.ts`.
- Regla de arquitectura: la capa de geometría no conoce el precio.
- Todo cambio del motor necesita una aserción analítica en `scripts/verify-engine.ts`; no se aceptan snapshots ni valores inventados.
- La persistencia (Supabase) guarda geometría con pack/unpack y tiene fallbacks para archivos grandes.
- Si el parseo es incompleto o hay operaciones desconocidas, el presupuesto debe bloquearse, no cotizarse a ciegas.
- El parser final debe correr en el navegador: TypeScript puro, sin APIs de Node, sin ejecutar binarios ni scripts del archivo.

## Alcance de esta carpeta

Esta carpeta es de investigación y prototipado. Podés usar Python, CLIs y herramientas de escritorio para analizar. Los entregables finales deben incluir:
- documentos de hallazgos con evidencia (offsets, bytes, strings);
- un parser prototipo en TypeScript si el formato resulta viable;
- un IR (representación intermedia) independiente de Bellari;
- tests y fixtures;
- una propuesta concreta de integración con Bellari.

## Reglas de trabajo

1. Evidencia primero: cada campo mapeado debe citar offset, tamaño, tipo, endianness y al menos un archivo de ejemplo. Si no hay evidencia, queda como “desconocido”.
2. No inventes campos, versiones ni semántica. Marcá confianza: alta / media / baja.
3. Diseñá experimentos diferenciales: pares de archivos que cambian una sola variable.
4. Documentá los comandos exactos y las versiones de herramientas para que todo sea reproducible.
5. Commits pequeños; `samples/` va en `.gitignore`; los fixtures sintéticos seguros sí se commitean.
6. No ejecutes macros, scripts embebidos ni instaladores del fabricante. No hagas ingeniería inversa de binarios del software: solo analizás archivos de datos del usuario.
7. No subas archivos de clientes a servicios externos. Si hay datos sensibles, redactá nombres y rutas.
8. Si el formato está cifrado, protegido o requiere evadir licencias, detenete y reportalo.
9. Al final de cada fase, dejá un resumen corto con hallazgos, dudas y qué sample haría falta después.

## Fase 0 — Corpus y procedencia

Antes de analizar, pedime esta información y registrala:

- software y versión que generó cada archivo (ArtCAM, EnRoute, Vectric, Mastercam, Biesse, Homag, SCM, etc.);
- marca y modelo de máquina, controlador y postprocesador;
- qué representa cada archivo (pieza, programa completo, nesting, relieve 3D);
- si existe el mismo diseño exportado en DXF, SVG y G-code;
- tamaño, fecha y si el archivo es texto o binario.

Armá:

- `samples/` (gitignored) con los archivos originales;
- `samples/MANIFEST.md` con SHA-256, origen, versión, postprocesador y descripción;
- un corpus mínimo de control con el mismo diseño simple variando UNA cosa por archivo:
  1. rectángulo 100×50 mm, 1 contorno, 1 pasada, herramienta Ø6, feed 1000;
  2. igual pero feed 1500;
  3. igual pero herramienta Ø3;
  4. igual pero 2 pasadas / 2 mm de profundidad;
  5. círculo Ø40 y un arco de 90°;
  6. un agujero perforado con ciclo de taladrado;
  7. mismo diseño en pulgadas;
  8. mismo diseño con origen desplazado;
  9. mismo diseño con tabs/bridges o lead-in;
  10. el mismo diseño exportado como DXF y como G-code.

El corpus diferencial es la herramienta más importante: sin él, cualquier mapeo es adivinanza.

## Fase 1 — Triage e identificación

Para cada archivo:

1. Tipo real: `file`, firma hexadecimal, `TrID`, `Detect It Easy`.
2. Texto o binario: `xxd -g1 -l 512`, `strings -a -n 6`, `strings -el` y `strings -eb`.
3. Contenedores:
   - ZIP: `PK\x03\x04`;
   - OLE/Compound File: `D0 CF 11 E0 A1 B1 1A E1` (usar `olefile` o `7z l`);
   - SQLite: `SQLite format 3`;
   - XML/JSON/INI: revisar primeras líneas;
   - compresión: zlib `78 9C`, gzip `1F 8B`, zstd `28 B5 2F FD`, lz4 `04 22 4D 18`, xz `FD 37 7A 58 5A`.
4. Entropía por bloques de 256 bytes para detectar zonas comprimidas o cifradas.
5. Strings de productor: “ArtCAM”, “Delcam”, “EnRoute”, “SAi”, “Vectric”, “Mastercam”, “BIESSE”, “WoodWOP”, “Homag”, “SCM”, “XXL”, “Mach3”, “GRBL”, etc. Verificar, no asumir.
6. Metadatos: fechas, rutas, nombres de herramientas, material, espesor, unidades.
7. Guardar `docs/01-triage.md` con una tabla: archivo, tipo, productor probable, evidencia, confianza.

## Fase 2 — Mapeo del formato

Si es texto/G-code/XML:
- tokenizar y listar el dialecto;
- identificar modalidades y comandos usados;
- comparar con el estándar y con el postprocesador.

Si es binario:
- hacer diff estructural entre archivos del corpus;
- identificar offsets que cambian con cada variable controlada;
- detectar campos de longitud, conteos, floats IEEE-754 de 32/64 bits, enteros con y sin signo, coordenadas, ángulos, flags, checksums y timestamps;
- detectar si hay compresión interna o registros de longitud variable;
- si es OLE, listar streams y analizar cada uno por separado.

Herramientas sugeridas para esta fase:
- `vbindiff`, `radiff2`, `cmp -l`, o un diff propio en Python que alinee offsets;
- `ImHex` con pattern language, `010 Editor` con templates, `HxD`;
- `CyberChef` para decodificar transformaciones;
- `Kaitai Struct` para describir la estructura una vez entendida;
- `Construct` (Python) para prototipar parsers binarios rápido;
- `olefile` / `oletools` para contenedores CFB (solo lectura, nunca ejecutar macros).

Documentá en `docs/02-format-map.md`:
- tabla de campos: offset, tamaño, tipo, endianness, significado, evidencia, confianza;
- diagrama de bloques del archivo;
- qué falta y qué sample lo resolvería.

## Fase 3 — Parser e IR

Definí un IR independiente de Bellari. Forma sugerida (ajustala con evidencia):

```ts
interface CncProgram {
  source: { filename: string; format: string; producer?: string; version?: string };
  units: 'mm' | 'inch';
  tools: CncTool[];
  operations: CncOperation[];
  stock?: { width: number; height: number; thickness?: number };
  warnings: CncWarning[];
  coverage: number; // 0..1: qué porcentaje del programa se entendió
}

interface CncTool {
  id: string;
  diameter: number;
  kind: 'endmill' | 'ball' | 'vbit' | 'drill' | 'other';
  rpm?: number;
}

interface CncOperation {
  id: string;
  kind: 'contour' | 'pocket' | 'drill' | 'engrave' | 'vcarve' | 'rapid' | 'other';
  toolId?: string;
  passes: number;
  depth?: number;
  paths: CncPath[];
}

interface CncPath {
  kind: 'line' | 'arc' | 'polyline';
  points: Array<{ x: number; y: number; z?: number }>;
  feed?: number;
  clockwise?: boolean;
  closed?: boolean;
}
Requisitos del parser:
- funciones puras, sin efectos secundarios;
- límites de tamaño y de número de operaciones para archivos maliciosos;
- errores explícitos, nunca any ni fallback silencioso;
- salida determinista;
- si una operación no se entiende, coverage baja y se reporta.
Para G-code, implementá un intérprete modal completo:
- G0/G1/G2/G3, G17/G18/G19;
- G20/G21 (pulgadas/mm), G90/G91 (absoluto/incremental);
- G54..G59, G28/G30;
- T y M6, S, M3/M5, F;
- arcos con I/J/K y con R, absolutos e incrementales;
- G41/G42 (compensación de herramienta), G43;
- ciclos de taladrado G81..G89;
- comentarios (...), ;, %, y códigos de postprocesador;
- cambios de plano y unidades a mitad de programa.
Si el archivo es XML/INI, modelá el esquema con Zod o validación manual estricta.
Fase 4 — Validación geométrica y de tiempos
Validá el parser contra valores analíticos, no contra snapshots:
- rectángulo 100×50: 300 mm por pasada; 2 pasadas = 600 mm;
- círculo Ø40: 2π·20 mm por pasada;
- arco de 90° con radio 10: π·10/2 mm;
- 1 pulgada = 25.4 mm;
- G2 y G3 deben dar la misma longitud, con orientación opuesta;
- I/J y R deben coincidir en el mismo arco;
- G90 y G91 deben reconstruir la misma geometría;
- conteo de perforaciones: una por entrada al material, no por movimiento;
- tiempo de corte = longitud / feed; tiempo rápido aparte;
- cambios de herramienta y dwell aparte.
Además:
- reconstruir las trayectorias y renderizarlas a SVG/PNG;
- superponerlas con el DXF del mismo diseño;
- comparar longitud, bbox y área de contornos cerrados;
- si hay compensación de herramienta, aplicar buffer con Shapely o equivalente antes de comparar;
- reportar diferencias esperables por lead-in, overtravel, tabs y múltiples pasadas.
Herramientas:
- ezdxf para leer el DXF de control;
- shapely para buffers, uniones y comparación geométrica;
- numpy y matplotlib para visualización y métricas;
- pytest y hypothesis para tests y propiedades;
- un simulador de G-code: CAMotics, NC Viewer, Universal Gcode Sender o LinuxCNC, para contrastar el interpretador;
- pygcode o gcodeparser como referencia, no como dependencia final.
Documentá docs/03-validation.md con la tabla de casos: esperado, obtenido, tolerancia, diferencia explicada.
Fase 5 — Propuesta de integración con Bellari
No reutilices PartGeometry para todo. Las trayectorias no son la pieza: hay compensación, pasadas, lead-ins, tabs y rápidos. Proponé:
- MachiningProgram como IR nuevo;
- un adaptador toQuoteMetrics(program) que devuelva: longitud de corte total, longitud por operación, perforaciones, longitud de rápidos, cantidad de pasadas, cambios de herramienta, tiempo estimado, bbox, espesor y unidades;
- un adaptador opcional toPartGeometry(program) solo si las trayectorias permiten reconstruir contornos cerrados con confianza;
- bloqueo de cotización si coverage < 1 o hay operaciones desconocidas;
- persistencia: guardar métricas derivadas y una versión compacta, no el archivo completo si es enorme;
- UI: modo “Trayectoria” para ver corte, rápidos, perforaciones y herramienta, reutilizando el visor 2D;
- separación estricta: el parser no conoce precios; el catálogo sigue siendo el único lugar de números comerciales.
Entregá docs/04-integration.md con:
- arquitectura propuesta;
- tipos TypeScript;
- impacto en presupuesto y DFM;
- riesgos y fallbacks;
- esfuerzo estimado (S/M/L) y dependencias.
Entregables finales
 1. docs/00-corpus.md — inventario y procedencia.
 2. docs/01-triage.md — tipo real, productor, evidencia.
 3. docs/02-format-map.md — mapa de campos y unknowns.
 4. spec/.ksy o equivalente — especificación del formato.
 5. src/ir/ — IR tipado.
 6. src/formats/ — parser prototipo por formato.
 7. tools/ — CLI de investigación:
- npm run inspect -- <archivo>: tipo, hash, strings, entropía, productor probable;
- npm run dump -- <archivo> --offset N --length M;
- npm run diff -- <a> <b>;
- npm run parse -- <archivo> --json;
- npm run render -- <archivo> --out salida.svg;
- npm run validate -- <archivo> --dxf control.dxf.
 8. tests/ — fixtures sintéticos y aserciones analíticas.
 9. README.md — cómo reproducir todo, versiones de herramientas y limitaciones.
10. Una matriz de factibilidad:
| Formato | Productor | Texto/Binario | Trayectorias | Confianza | Esfuerzo | Recomendación |
|---|---|---|---|---|---|---|


Criterios de éxito y de abandono
Éxito mínimo:
- identificar el tipo real de cada archivo con evidencia;
- extraer al menos unidades, herramientas y trayectorias de un formato;
- validar longitudes y perforaciones contra DXF/G-code con tolerancia explicada;
- dejar un parser TypeScript prototipo y una propuesta de integración.
Abandono explícito:
- si después de un corpus diferencial razonable no hay mapeo estable;
- si el formato está cifrado o protegido;
- si solo se puede avanzar con software del fabricante o evadiendo licencias;
- si el esfuerzo supera el valor: en ese caso recomendá exportar DXF/SVG/G-code como vía oficial.
En todos los casos, entregá el informe de hallazgos y la recomendación, aunque sea “no conviene”.
Herramientas de referencia
CLI y sistema:
- file, xxd, hexdump, strings, binwalk, 7z, unzip, sha256sum, git;
- TrID, Detect It Easy, CyberChef;
- vbindiff, radiff2, cmp.
Python:
- construct, kaitai-struct-compiler, olefile, oletools, python-magic;
- ezdxf, shapely, numpy, matplotlib;
- pytest, hypothesis;
- pygcode o gcodeparser como referencia.
TypeScript/Node:
- tsx, vitest, zod;
- un parser G-code propio o una librería existente, verificando mantenimiento y licencia;
- sin dependencias pesadas en el runtime final del navegador.
Visualización y simulación:
- ImHex (patterns), 010 Editor (templates), HxD;
- CAMotics, NC Viewer, Universal Gcode Sender, LinuxCNC;
- extensiones de VS Code: Hex Editor y Kaitai Struct.
Identificación y documentación:
- PRONOM (The National Archives) y la base de file magic;
- manuales públicos y foros de ArtCAM, EnRoute, Vectric, Mastercam, Biesse, Homag y SCM;
- documentación de G-code estándar (RS-274/NGC) y del controlador de la máquina.
Preguntas que tenés que hacer antes de empezar
1. ¿Qué software y versión generó cada archivo?
2. ¿Qué máquina, controlador y postprocesador se usó?
3. ¿Podés exportar el mismo diseño en DXF, SVG y G-code?
4. ¿Cuáles son los archivos más importantes para el negocio?
5. ¿Hay archivos de diferentes versiones o de diferentes máquinas?
6. ¿Hay restricciones de confidencialidad o NDA?
7. ¿Qué sistema operativo y herramientas tenés disponibles (WSL, Python, Node)?
8. ¿El objetivo es cotizar mecanizado, reconstruir la pieza, o ambas cosas?
Forma de trabajo
- Empezá por la Fase 0 y la Fase 1; no escribas un parser hasta tener el triage.
- Mostrame el primer mapa de bytes y las dudas antes de avanzar a ciegas.
- Mantené un archivo docs/UNKNOWNS.md con preguntas abiertas y el sample que las resolvería.
- Al cerrar cada fase, dejá un resumen de 10 líneas con: qué se confirmó, qué se descartó y qué sigue.
- Si un supuesto resulta falso, corregilo y anotá la evidencia.

### Cómo te puedo ayudar después

Cuando tengas los primeros resultados, traelos y te ayudo a:

- interpretar los hexdumps y proponer el siguiente experimento diferencial;
- diseñar el IR y el adaptador `toQuoteMetrics` para que encaje con `PartGeometry` y el motor de precios;
- escribir el parser TypeScript definitivo, con límites, errores explícitos y `coverage`;
- agregar las aserciones analíticas en el estilo de `scripts/verify-engine.ts`;
- integrar el modo “Trayectoria” en el visor 2D y definir la política de bloqueo cuando el parseo sea incompleto;
- revisar la matriz de factibilidad y decidir si conviene el parser nativo o la vía “exportá DXF/SVG/G-code”.

Mi recomendación práctica: antes de invertir en `.art`, hacé que el agente confirme si tus `.cnc` son G-code de texto. Si lo son, el importador de trayectorias es mucho más barato y ya te habilita a cotizar tiempo de mecanizado, perforaciones y pasadas.