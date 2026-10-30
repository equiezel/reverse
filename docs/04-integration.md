# 04 - Propuesta de integracion con Bellari

## Arquitectura

Mantener el parser y el IR neutrales al negocio, separados del cotizador:

1. Detectar firma y formato; no confiar en extension.
2. Parsear a `CncProgram` con coordenadas en mm, movimientos ordenados,
   operaciones inferidas, advertencias, coverage y datos de origen.
3. Calcular `QuoteMetrics` con `toQuoteMetrics`; los valores comerciales y
   precios siguen fuera de esta capa.
4. Bloquear cotizacion automatica cuando coverage es incompleto, aparecen
   offsets desconocidos o el formato solo aporta metadata.
5. Mostrar las trayectorias como programa de mecanizado, no convertirlas
   automaticamente a `PartGeometry`.

## Estado de tipos y adaptadores

`src/ir/types.ts` ya contiene `CncProgram`, `CncMove`, `CncOperation`,
`CncPath`, `CncTool`, warnings y metricas. `src/formats/gcode/metrics.ts`
expone longitud de corte/engaged, rapidos, entradas, perforaciones, pasadas,
cambios M6, tiempos estimados, bbox, Z, advertencias y coverage.

No existen adaptadores hacia `PartGeometry`, persistencia de Bellari, UI,
versionado de IR ni contratos de importacion publicos. No se recomienda
implementar `toPartGeometry` hasta demostrar que los paths son contornos de la
pieza y no centros de herramienta, lead-ins o recorridos de mecanizado.

## Politica recomendada

- Permitir previsualizar y reportar metricas con advertencias.
- No cotizar si `coverage < 1`, hay operaciones desconocidas o offsets que
  cambian la geometria sin resolucion.
- Marcar tiempos como estimados mientras rapidos, aceleraciones, cambios de
  herramienta o dwell dependan de supuestos.
- Persistir un resumen de metricas y una version identificada del IR; no
  almacenar el archivo de origen grande por defecto.
- Mantener los originales en el cliente y respetar sus restricciones de
  confidencialidad.

## Riesgos y esfuerzo

| Entregable | Esfuerzo | Bloqueos |
|---|---|---|
| Importacion de G-code con dialecto identificado | M | falta productor/controlador/post |
| Exportar trayectorias en vista 2D | M | validar orden, rapidos, arcos y Z |
| Tiempo CNC comercial defendible | M/L | calibrar feed/rapid/cambios con maquina |
| Reconstruir pieza desde trayectorias | L | compensacion, entradas, tabs y multipasada |
| Importar geometria de toolpaths ArtCAM `.art` | L/indeterminado | `Data2`/`RampData` sin decodificar |
| Importar EPS en runtime TS | M | definir subconjunto seguro y pruebas vectoriales |

## Criterios antes de integrar

1. Obtener corpus de maquina y postprocesador identificados.
2. Confirmar unidades, work offsets, compensacion y convencion de Z.
3. Validar feed/rapid/time con un simulador o control independiente.
4. Asegurar cobertura de todos los comandos del dialecto observado.
5. Confirmar restricciones de confidencialidad y que el parser corre en
   navegador sin APIs de Node.
6. Mantener una barrera de bloqueo cuando la semantica no se entienda.

## Resumen de fase

1. El IR y las metricas neutrales ya existen para G-code.
2. El IR incluye movimientos y operaciones, no solo el contorno nominal.
3. El parser no depende del precio ni del catalogo.
4. No hay adaptador Bellari ni cambios en el repositorio destino.
5. ArtCAM solo aporta metadata y no es cotizable.
6. EPS no cuenta con parser del runtime.
7. `PartGeometry` no debe inferirse sin conocer compensacion.
8. Los tiempos dependen de tasas/supuestos configurables.
9. Falta una maquina de referencia para validar los estimados.
10. Siguiente paso: definir dialecto objetivo y criterio de aceptacion con el usuario.
