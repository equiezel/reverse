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
| BoundingBox | comentario `%%BoundingBox` | coordenadas PostScript; requiere convertir unidades |
| Escala | operador `2.834646 2.834646 scale` | puntos PostScript por mm |
| Operadores vectoriales | cuerpo | `moveto`, `lineto`, `curveto`, `closepath`, `stroke` |

El analizador Python aproxima curvas Bezier con segmentos y no es un interprete
PostScript general. No se debe ejecutar PostScript para analizarlo. No hay
todavia parser EPS en TypeScript ni una geometria de referencia aprobada.

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
7. El EPS declara escala 2.834646 entre mm y PostScript.
8. Sus Bezier se aproximan en el script de investigacion, no en el runtime.
9. No se declara un esquema binario de campos que no se ha probado.
10. Siguiente paso: comparar dos `.art` exportados variando una sola opcion.
