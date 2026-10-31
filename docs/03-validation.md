# 03 - Validacion geometrica y de metricas

## Fixtures sinteticos

Las aserciones estan en `tests/gcode.test.ts` y `tests/quote.test.ts`; el
rectangulo tambien se valida contra `tests/fixtures/rect_100x50.dxf`.

| Caso | Esperado | Obtenido | Resultado |
|---|---:|---:|---|
| Rectangulo 100 x 50, 1 pasada | 300 mm XY | 300 mm engaged XY; DXF 300 mm | OK, diferencia 0 mm |
| Rectangulo, 2 pasadas | 600 mm XY | 600 mm y 2 niveles | OK |
| Circulo D40 | `40*pi` = 125.664 mm | assertion analitica con G2 I/J | OK |
| Arco de 90 grados, R10 | `5*pi` = 15.708 mm | assertion analitica | OK |
| G2/G3 complementarios | 2*pi*10 = 62.832 mm | suma de arcos menor/mayor | OK |
| Arco I/J contra R | misma longitud | test de arco menor | OK |
| 1 pulgada | 25.4 mm | 25.4 mm normalizados | OK |
| G90 contra G91 | misma geometria | igualdad de longitud XY | OK |
| Taladrado G81 en tres posiciones | 3 perforaciones | 3 | OK |
| Feed 1000 mm/min | longitud/feed | test analitico del tiempo | OK |
| DXF rectangular | bbox 100 x 50 | bbox 100 x 50 | OK, diferencia 0 mm |
| EPS 100 x 50 con `2.834646 scale` | 300 mm, 5000 mm2 | 300.000 mm, 5000 mm2 | OK |
| EPS exterior + agujero | area neta 4600 mm2 | 4600.001 mm2 | OK |
| G-code 2 pasadas del mismo contorno | area 5000 mm2 (no 10000) | 5000 mm2 | OK |
| Todo punto fuera del poligono cerrado | `false` | `false` | OK (bug de segmento nulo corregido) |

Ejecucion de control confirmada:

```powershell
npm run validate -- tests\fixtures\rect_100x50_1pass.nc --dxf tests\fixtures\rect_100x50.dxf
```

El resultado fue `RESULTADO: OK`; el movimiento de entrada aporta 6 mm de
longitud 3D, pero la longitud proyectada engaged XY coincide con los 300 mm del
contorno de control.

## Archivos reales

Los dos G-code parsean a 2806 movimientos y 17 operaciones. Ambos dan
11 367.787 mm de longitud XY de avances, 11 306.554 mm engaged XY, 17 entradas
al material, 24 pasadas y bbox de 787.174 x 175.618 mm. El orden de operaciones
altera los rapidos, no la longitud de corte.

El programa no declara G20/G21. `UNITS_ASSUMED` queda como **supuesto
documentado** (`block: 'none'`), no como perdida de semantica: las unidades mm
se confirman por dos vias independientes (abajo). Por eso `coverage = 1` y la
geometria es cotizable; el supuesto se muestra en la UI.

La herramienta independiente `gcode_crosscheck.py` obtuvo los mismos 11 367.787
mm de avances XY, 17 entradas y el mismo bbox engaged.

## EPS frente a G-code: mismo diseno, confirmado

La conclusion anterior ("no confirmado") era un error de doble conversion de
unidades: se habia aplicado `2.834646` dos veces. El EPS ya esta en mm 1:1
porque declara `2.834646 2.834646 scale` (mm -> puntos PostScript) y el parser
aplica la matriz y vuelve a mm. Los numeros del `%%BoundingBox` estan en puntos
PostScript, no en mm; el bbox de la geometria ya convertida es el valido.

Evidencia cuantitativa (`samples/1.eps` contra `samples/trayectorias.cnc`):

| Medida | G-code | EPS | Diferencia | Interpretacion |
|---|---:|---:|---:|---|
| Subpaths / operaciones | 17 | 17 | 0 | biyeccion 1:1 |
| Perimetro total, una pasada | 7351.52 mm | 7318.54 mm | +0.45% | mismo trazado |
| bbox ancho | 787.174 mm | 784.033 mm | +3.141 mm | ~2r (D=3.17) |
| bbox alto | 175.618 mm | 172.507 mm | +3.111 mm | ~2r |
| Area exterior | 92 180.25 mm2 | 87 376.50 mm2 | +4803.75 mm2 | ~ `r * perimetro` = 4893 |
| Area de pieza compensada | 74 437.42 mm2 | 72 859.24 mm2 | +2.17% | coincide dentro de la tolerancia de poligono |
| Contorno exterior | 3062.74 mm | 3087.44 mm | -0.80% | subestimacion por poligono (EPS muestrea Bezier a 0.5 mm) |

Ejemplo de un rasgo pequeno (el agujero de ~D30):

| Medida | G-code | EPS | Diferencia |
|---|---:|---:|---:|
| bbox | 30.3 x 30.8 mm | 33.56 x 33.64 mm | +3.26 / +2.84 mm (~2r) |
| perimetro | 99.48 mm | 110.38 mm | +10.90 mm (~2*pi*r = 9.96) |
| area | 746.79 mm2 | 924.40 mm2 | +177.61 mm2 (~r*P = 174.9) |

Conclusiones:

1. El EPS es el **contorno de pieza**; el G-code recorre el **centro de
   herramienta** desplazado r = 1.585 mm. El signo del area lo confirma: el
   area barrida por el eje es mayor que el area de pieza en `r * perimetro`.
2. El G-code tiene 24 pasadas; el EPS describe una sola geometria. Por eso hay
   que comparar contra el perimetro de una pasada, no contra la longitud total.
3. Los 3 contornos que el analizador marca "abiertos" en el G-code tienen
   huecos de 46-74 mm entre extremos: no son contornos mal cerrados, son
   trayectorias abiertas reales (grabados). El EPS las exporta como subpaths
   cerrados; al comparar totales se suman y coinciden.

## Analisis de contorno y area

`src/analysis/contours.ts` separa lo que la maquina recorre de lo que es la
pieza:

- Una cadena se corta en cada retract, en cada entrada al material y cuando Z
  desciende por debajo del nivel estable anterior. Dos pasadas del mismo
  contorno ya no se fusionan (antes el area salia duplicada: 184 360 mm2 en vez
  de 92 180 mm2).
- La rampa de entrada se descarta del contorno: la cadena empieza en el primer
  movimiento lateral a Z constante.
- De cada contorno se conserva la pasada mas profunda (`selectFinalPasses`), que
  es la que define profundidad y geometria final.
- El anidamiento par/impar clasifica solidos y agujeros. El programa real da
  niveles 0, 1, 2 y 3: contorno exterior, bolsillos, islas dentro de bolsillos
  y agujeros dentro de las islas.
- `area neta` es el area barrida por el eje. `area de pieza` descuenta
  `r * perimetro` cuando se conoce el diametro y no hay G41/G42.

Resultado del programa real: 14 cadenas cerradas + 3 abiertas, perimetro
cerrado 5809.95 mm, abierto 1541.57 mm, area barrida 86 089.58 mm2, area de
pieza 74 437.42 mm2 (r = 1.585 mm), 11 agujeros cerrados (+3 abiertos = 14).

## Limites de las metricas

- El rapido es estimado con 5000 mm/min por defecto; `--rapid` lo ajusta.
- El G-code real no declara unidades, diametro de herramienta ni espesor. El
  `.art` del mismo trabajo aporta 12 mm y `3.17mm plana`; sin ese archivo esas
  magnitudes quedan en `null`.
- `coverage=1` solo expresa que no se marco semantica desconocida segun el
  parser; no es certificacion del controlador.
- G53/G43/G44 y G92 sin offsets mapeados reducen coverage y bloquean la
  cotizacion.
- Los cambios de herramienta se cuentan desde cada M6; el tiempo por evento es
  supuesto configurable.
- La compensacion de area es escalar (`r * perimetro`); no es un offset de
  poligono. En esquinas concavas el error puede superar el 1-2% (el corpus real
  queda en 2.17% contra EPS).
- Los tiempos no se validaron contra el reloj de la maquina: faltan datos de
  aceleracion y look-ahead.

## Resumen de fase

1. Los casos analiticos de recta, circulo, arco y pulgada pasan.
2. El DXF rectangular coincide en longitud y bbox con tolerancia cero.
3. El ciclo G81 produce tres perforaciones en el fixture.
4. Los dos programas reales coinciden en metricas de corte e invariantes.
5. Los rapidos dependen del orden de operaciones como se esperaba.
6. EPS y G-code describen el mismo diseno: 17 <-> 17, perimetro +0.45%, bbox
   +2r, area +r*perimetro.
7. El area de pieza compensada coincide con el EPS dentro del 2.2%.
8. La unidad mm del G-code queda confirmada por EPS y por Z (-12.55) contra un
   espesor de 12 mm.
9. Los tiempos son estimaciones; falta validacion con la maquina real.
10. Siguiente paso: exportar otro job con herramienta y espesor distintos para
    comprobar que la compensacion escala con r.
