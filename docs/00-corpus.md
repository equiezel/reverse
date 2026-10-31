# 00 - Corpus y procedencia

## Inventario

| Archivo | Bytes | SHA-256 | Identificacion actual |
|---|---:|---|---|
| `trayectorias.cnc` | 56 671 | `147dace03d3c6565a45db11cc6912800059ea70f0ab451ac382e6f52a6ca06a3` | G-code de texto |
| `1 (1).cnc` | 56 671 | `2e16c06f7bad194facc8eed69a56682fd915ab875774182ddb997772fb8b3dfa` | G-code de texto |
| `art.art` | 227 328 | `6867001f35bc673b629dbfcb2a1b68f2d53a263b74558ec9eb083af64035aa1e` | CFB/OLE2 con streams ArtCAM |
| `1.eps` | 41 317 | `fefc775e0346f096a93bc97430cb82984debcf2f582bae8321a1874cff3319d8` | EPS/PostScript, Creator ArtCAM |

Hashes y comandos para regenerarlos: [samples/MANIFEST.md](../samples/MANIFEST.md).
Los originales no se incluyen en Git; las copias disponibles en el workspace se
mantienen fuera de versionado mediante `.gitignore`.

## Procedencia conocida

- Los cuatro archivos llegaron juntos, pero no hay registro verificable del
  operador, fecha de exportacion o configuracion de postprocesador.
- El usuario recuerda ArtCAM 9 como origen y cree que podria tratarse de Mach2.
  Es una pista de procedencia, no una identificacion confirmada por los bytes
  ni por el encabezado del G-code.
- El nombre `1 (1).cnc` no prueba que sea duplicado. El contenido tiene mismo
  tamano y 2806 movimientos interpretados que `trayectorias.cnc`, pero hash
  distinto y diferente orden de operaciones.
- El EPS declara `%%Creator: ArtCAM`, `%%Title: Contour data from ArtCAM` y un
  escalado PostScript de `2.834646` unidades por milimetro (mm -> puntos).
- El `.art` contiene version ArtCAM 9.021, material `Material`, espesor 12 mm y
  dos toolpaths con descripcion de herramienta `3.17mm plana`.
- El EPS y los dos G-code corresponden al mismo diseno: 17 subpaths <-> 17
  operaciones, perimetro +0.45%, bbox +2r. El G-code recorre el centro de
  herramienta; el EPS es el contorno de pieza. Ver
  [03-validation.md](./03-validation.md).

## Campos de Fase 0 que faltan

No estan confirmados: version exacta de software que exporto cada `.cnc`, marca
y modelo de maquina, controlador/postprocesador, significado de cada archivo,
si hay versiones de maquina distintas y condiciones de confidencialidad. El
usuario confirmo que el objetivo es **cotizar mecanizado con exactitud**, no
reconstruir la pieza. Puede aportar DXF/SVG de control del mismo job; aun falta
recibirlo con unidades, origen y compensacion documentados.

## Resumen de fase

1. Se inventariaron cuatro archivos por tamano y SHA-256.
2. Los originales permanecen excluidos del repositorio.
3. Los dos `.cnc` son texto G-code, no se identificaron como binarios.
4. El `.art` es un contenedor OLE2/CFB de ArtCAM.
5. El EPS es PostScript vectorial generado por ArtCAM.
6. El `.art` declara version 9.021 y stock de 12 mm.
7. El `.art` contiene dos toolpaths con herramienta de 3.17 mm.
8. EPS y G-code son el mismo diseno y la unidad mm queda confirmada.
9. ArtCAM 9 y Mach2 son recuerdos del usuario, no confirmaciones del archivo.
10. Siguiente paso: agregar un DXF de control y confirmar procedencia.
