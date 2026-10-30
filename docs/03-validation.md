# 03 - Validacion geometrica y de metricas

## Fixtures sinteticos

Las aserciones estan en `tests/gcode.test.ts`; el rectangulo tambien se valida
contra `tests/fixtures/rect_100x50.dxf`.

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

Ejecucion de control confirmada:

```powershell
npm run validate -- tests\fixtures\rect_100x50_1pass.nc --dxf tests\fixtures\rect_100x50.dxf
```

El resultado fue `RESULTADO: OK`; el movimiento de entrada aporta 6 mm de
longitud 3D, pero la longitud proyectada engaged XY coincide con los 300 mm del
contorno de control.

## Archivos reales

Los dos G-code parsean a 2806 movimientos y 17 operaciones. Ambos dan 11 367.787
mm de longitud XY de avances, 11 306.554 mm engaged XY, 17 entradas al material,
24 niveles de pasada y bbox de 787.174 x 175.618 mm. El orden de operaciones
altera los rapidos, no la longitud de corte. El parser emite `UNITS_ASSUMED`:
no se vio G20/G21 en el programa, por lo que las unidades se asumieron mm; las
metricas quedan disponibles para inspeccion, pero la cotizacion automatica se
bloquea por esa ambiguedad (coverage aproximado 99.96%).

La herramienta independiente `gcode_crosscheck.py` obtuvo los mismos 11 367.787
mm de avances XY, 17 entradas y el mismo bbox engaged. Es una comprobacion
independiente parcial: no valida tiempos ni ciclos, y no reemplaza el control
de dialecto de la maquina.

## EPS frente a G-code: no confirmado

`1.eps` produce 17 subpaths con el script de investigacion y un bbox aproximado
de 276.589 x 60.855 mm tras convertir por `2.834646`. El G-code produce un bbox
de 787.174 x 175.618 mm. La comparacion exploratoria de subpaths no logro
correspondencia: error promedio de caja 100 mm y maximo 215.320 mm con un
pareo voraz no validado. Longitudes y ubicaciones tampoco se alinean con una
simple correccion por radio de herramienta. Por eso se retira como afirmacion
la equivalencia de diseño/escala 1:1 entre EPS y G-code hasta conseguir una
exportacion de control fiable.

`npm run validate -- <programa> --dxf <archivo>` solo admite DXF ASCII. Pasarle
un EPS se interpreta incorrectamente como DXF vacio; usar EPS causa un falso
fallo y no constituye una comparacion valida.

## Limites de las metricas

- El rapido es estimado con 5000 mm/min por defecto.
- El G-code real no declara unidades, diametro de herramienta ni espesor.
- `coverage=1` solo expresa que no se marco semantica desconocida segun el
  parser; no es certificacion del controlador. La unidad asumida siempre reduce
  coverage y bloquea la cotizacion.
- G53/G43/G44 y G92 sin offsets mapeados ahora reducen coverage y bloquean la
  cotizacion.
- Los cambios de herramienta se cuentan desde cada M6; el tiempo por evento es
  supuesto configurable.
- No se valida compensacion de herramienta ni se compara area/solapamiento.

## Resumen de fase

1. Los casos analiticos de recta, circulo, arco y pulgada pasan.
2. El DXF rectangular coincide en longitud y bbox con tolerancia cero.
3. El ciclo G81 produce tres perforaciones en el fixture.
4. Los dos programas reales coinciden en metricas de corte e invariantes.
5. Los rapidos dependen del orden de operaciones como se esperaba.
6. El G-code real no declara unidades; el parser asume mm solo para inspeccion.
7. La comparacion EPS/G-code no valida que sean el mismo diseño.
8. El script EPS es exploratorio y aproxima Bezier.
9. No hay comparacion aprobada de area, compensacion o toolpaths ArtCAM.
10. Siguiente paso: pedir DXF y exportaciones del mismo job con offsets conocidos.
