# 02 - Mapa de formato y campos conocidos

Los `.cnc` son texto; el mapa binario aplica al contenedor `.art`. Offset en
streams significa relativo al comienzo del stream, no al archivo CFB. No se
promueven offsets de campos a estables si solo se hallaron por busqueda.

## ArtCAM `.art`

| Campo | Stream / offset | Tipo y endianness | Valor observado | Evidencia y confianza |
|---|---|---|---|---|
| Firma CFB | archivo `0x00`, 8 bytes | bytes constantes | `D0 CF 11 E0 A1 B1 1A E1` | Header del sample y parser CFB; alta |
| Version ArtCAM | `ArtCAM/VersionInfo/VersionA`, desplazamiento no fijado | texto UTF-16LE | `ArtCAM 9.021` | Stream extraido y regex; media |
| Nombre de material | `ArtCAM/Material/MaterialDescription`, stream `+4` | ASCII, terminacion NUL | `Material` | Parser comienza lectura en 4; media |
| Espesor de material | `ArtCAM/Material/MaterialThickness`, `+0`, 8 bytes | IEEE-754 float64 little-endian | `12` mm | `DataView.getFloat64(..., true)` y test; alta para este sample |
| Version y cantidad de toolpaths | `ArtCAM/ToolpathData/#ToolpathList`, `+0` y `+2` | dos u16 little-endian | Valores numericos no publicados | Parser y test del stream; media |
| IDs de toolpaths | mismo stream, desde `+4` | repeticion `[u16 longitud][bytes ASCII]` | dos IDs listados en tests | Estructura implementada y test; media |
| Descripcion de herramienta | stream `.../<id>/Parameters`, offset no estable | patron buscado `[u32 chars][UTF-16LE]` | `3.17mm plana` | Busqueda lineal, no offset estable; media/baja |
| Diametro de herramienta | extraido de la descripcion | decimal textual en mm | `3.17` mm | Regex del texto, no campo binario independiente; media |
| Geometria del toolpath | streams `Data2` y `RampData` | desconocido | no decodificada | No existe parser semantico; desconocida |

La firma de contenedor y estructuras internas de CFB se leen con enteros
little-endian segun la implementacion de
[cfb.ts](../src/formats/artcam/cfb.ts); los offsets CFB adicionales no son un
mapa del formato ArtCAM y no se listan aqui como semantica de negocio. La
construccion depende de la especificacion MS-CFB.

## EPS/PostScript

| Evidencia | Ubicacion | Resultado |
|---|---|---|
| Encabezado | archivo `+0` | `%!PS-Adobe-3.0 EPSF-3.0` |
| Productor y titulo | comentarios EPS | `ArtCAM`; `Contour data from ArtCAM` |
| `%%BoundingBox` | comentario DSC | en **puntos PostScript**; no es mm |
| Escala | operador `2.834646 2.834646 scale` | mm -> puntos PostScript (72/25.4) |
| Operadores de dibujo | cuerpo | `moveto`, `lineto`, `curveto`, `stroke`, `fill` |
| Operadores de estado | cuerpo | `gsave`, `grestore`, `translate`, `rotate`, `concat` |
| Cierre de subpath | fin de cada subpath | ArtCAM no emite `closepath`: repite el punto inicial |

### Unidades y transformacion

El EPS de ArtCAM ya esta en milimetros: dibuja con `scale 2.834646` para pasar
de mm a puntos PostScript. El parser aplica la matriz de transformacion (CTM) y
divide por `72/25.4`, de modo que la geometria resultante queda en mm. Aplicar
la escala dos veces produce un error de 8x y fue la causa de una conclusion
anterior equivocada ("EPS de otro diseno").

El `%%BoundingBox` esta en puntos PostScript; para compararlo con el G-code hay
que dividirlo por `72/25.4`. El bbox de la geometria parseada (`geometryBboxMm`)
es el que se usa en el IR.

### Relacion con el G-code

`1.eps` y `trayectorias.cnc` son el mismo trabajo:

- 17 subpaths EPS <-> 17 operaciones G-code;
- perimetro total a una pasada: 7318.54 mm (EPS) contra 7351.52 mm (G-code),
  +0.45%;
- bbox EPS 784.033 x 172.507 mm contra 787.174 x 175.618 mm del G-code: la
  diferencia es ~2r con r = 1.585 mm (herramienta `3.17mm plana`);
- el G-code recorre el centro de herramienta; el EPS es el contorno de pieza.

Detalle y tablas en [03-validation.md](./03-validation.md).

### Lector TypeScript

`src/formats/eps.ts` es un subconjunto seguro y acotado: tokeniza, aplica solo
operadores de geometria/transformacion y **no ejecuta PostScript**. Aproxima
Bezier cubicas con segmentos de <= 0.5 mm de cuerda (8 a 128 tramos). Limites:
8 MB de texto, 2 millones de tokens, 2 millones de puntos; al excederlos lanza
`EpsError`. Los operadores desconocidos se listan en `unsupported` y no alteran
la geometria.

## Que aporta cada formato al presupuesto

| Magnitud | G-code `.cnc` | EPS | `.art` |
|---|---|---|---|
| Perimetro / area de pieza | si (compensando r) | si, directo | no (geometria sin decodificar) |
| Longitud real recorrida | si | no | no |
| Pasadas y profundidad | si | no | profundidad declarada, sin trayectoria |
| Tiempo de maquina | estimado con F y rapido supuesto | no | no |
| Herramienta (diametro) | no | no | si (`3.17mm plana`) |
| Espesor de material | no | no | si (12 mm) |
| RPM | si (M3 S...) | no | si (18000) |

Regla de integracion: usar el G-code para mecanizado y tiempo; el EPS para
verificar el contorno y el area; el `.art` para herramienta y espesor. Nunca
inventar el dato que falta: queda `null` y se declara en `assumptions`.

## G-code

Es texto ASCII con CRLF. El parser tokeniza letras y numeros de bloques, quita
comentarios entre parentesis, comentarios `;`, `%` y checksum `*`. La unidad
base del IR es mm; el origen de stock se interpreta en Z=0, con Z positivo
hacia arriba. Los detalles de modalidades soportadas, restricciones y comandos
que bloquean cotizacion se mantienen en
[spec/gcode-supported.md](../spec/gcode-supported.md).

## Resumen de fase

1. La firma CFB identifica el contenedor, no el esquema interno ArtCAM.
2. El espesor del sample se decodifica como float64 little-endian a offset 0 del stream.
3. Material y version se leen de streams conocidos; offsets de version no fijados.
4. La lista de toolpaths tiene header u16/u16 y strings con prefijo de longitud.
5. La descripcion de herramienta se detecta buscando texto UTF-16LE.
6. La geometria compacta de `Data2` y `RampData` sigue sin mapear.
7. El EPS declara escala 2.834646 entre mm y puntos PostScript.
8. Sus subpaths se cierran repitiendo el punto inicial, no con `closepath`.
9. El lector EPS es TypeScript puro y no ejecuta PostScript.
10. EPS y G-code son el mismo diseno; el `.art` aporta herramienta y espesor.
11. Siguiente paso: comparar dos `.art` exportados variando una sola opcion.
