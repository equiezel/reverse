# G-code parser - contrato de soporte actual

Este documento describe el comportamiento del prototipo, no certifica
conformidad completa con RS-274/NGC ni sustituye el manual del controlador.

## Normalizacion

- Coordenadas, distancias, radios y feed se convierten a mm y mm/min en el IR.
- Z=0 representa la cara superior del material; Z positivo queda fuera.
- Si no aparece G20/G21, se asume mm solo para reconstruir geometria, se emite
  warning, coverage baja y la cotizacion automatica queda bloqueada.
- Posicionamiento absoluto G90 e incremental G91.
- Los arcos representan centro/radio/barrido, con muestreo para render.
- `coverage` se basa en bloques que no tuvieron semantica marcada como
  desconocida. Cualquier bloque desconocido bloquea la cotizacion, incluso si
  el porcentaje mostrado redondea a 1. `quotable` no equivale a validacion en
  maquina.

## Comandos tratados

| Grupo | Codigos/palabras | Tratamiento |
|---|---|---|
| Movimiento | G0, G1, G2, G3 | Rapido, avance y arcos |
| Plano | G17, G18, G19 | XY, XZ, YZ |
| Unidades/modalidad | G20, G21, G90, G91, G90.1, G91.1 | Unidades, distancia y centro de arco |
| Arcos | I, J, K, R | Centro incremental/absoluto o radio; errores estructurales explicitos |
| Feed | F, G93, G94, G95, S | Tiempo estimado; G95 sin RPM no estimable |
| Herramienta | T, M6 | Registra herramientas y cada evento M6 |
| Spindle | M3, M4, M5 | Estado modal; RPM almacenadas |
| Ciclos | G73, G81, G82, G83, G85, G86, G89, G80, G98, G99 | Subconjunto de taladrado; algunos ciclos se aproximan |
| Comentarios | `( ... )`, `;`, `%`, N, `*checksum` | Eliminados antes de interpretar |
| Pausa | G4 | Dwell |
| Offsets | G54-G59 | Seleccion registrados, no se conoce su valor |
| Compensacion | G40-G42, G43/G44/G49 | No se aplican offsets; modos sin resolver bloquean cotizacion |
| Coordenadas especiales | G53, G28/G30, G92 | No se conoce transformacion/home; warning y bloqueo cuando aplica |

## Politica de no soporte

- Codigo G/M o palabra no reconocida: warning y coverage reducido.
- Arco imposible, radio incompatible, archivo vacio o limites excedidos:
  `CncParseError`.
- G41/G42, G43/G44, G53 y G92 con efecto geometrico desconocido: no cotizar.
- G28/G30 con coordenadas de retorno no modeladas: no cotizar ese bloque.
- G84/G87/G88: ciclo aproximado a un ciclo simple con warning; no se debe
  tratar como equivalente exacto a roscado o ciclo de fabricante.
- El estado de offsets de trabajo G54-G59 se selecciona pero sus valores no
  estan disponibles; confirmar que el archivo ya expresa coordenadas de pieza.

## Limites de recursos

Defaults en `parse.ts`: 32 MiB de texto, 2 000 000 lineas, 1 000 000
movimientos, 100 000 operaciones y 500 warnings. El muestreo de arco se limita
a 720 segmentos. Estos limites deben revisarse si el parser se expone a
archivos no confiables en navegador.

## No incluido

No se implementa interpretacion general de macros/variables, subprogramas,
compensacion real de herramienta, offsets de maquina, aceleracion/jerk,
parametros de fabricante ni todos los detalles temporales de ciclos. Un
programa que parezca parsearse completo puede depender de esas semanticas.
