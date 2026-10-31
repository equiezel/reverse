# Unknowns y evidencia necesaria

| Pregunta / campo | Estado | Evidencia que lo resolveria |
|---|---|---|
| Software/version que genero cada `.cnc` | Usuario recuerda ArtCAM 9; el `.art` dice `ArtCAM 9.021`, pero el `.cnc` no lo declara | Nombre/version del CAM y confirmacion para cada archivo |
| Marca/modelo de router, controlador y postprocesador | Mach2 es posible segun recuerdo; maquina y post desconocidos | Identificacion de maquina/controlador y archivo de post |
| Unidades efectivas de los dos `.cnc` | **Resuelto para el corpus**: mm, confirmado por EPS (1 unidad = 1 mm) y por Z -12.55 contra espesor 12 mm. El archivo no declara G20/G21 | Reexportar con unidades declaradas |
| Work offsets y origen de pieza | No documentados; el programa usa coordenadas de pieza con origen en 0 | Archivo con origen conocido o tabla de offsets del job |
| EPS y G-code son el mismo diseno | **Confirmado**: 17 <-> 17, perimetro +0.45%, bbox +2r, area +r*perimetro | Ya validado en [03-validation.md](./03-validation.md) |
| Objetivo de producto | Confirmado: cotizar mecanizado, no reconstruir la pieza | Prioridad comercial del usuario |
| NDA/permiso de conservar muestras | No confirmado directamente | Confirmacion del usuario y politica de retencion |
| Diametro de herramienta en el G-code | No declarado; se toma del `.art` (`3.17mm plana`) | G-code con comentario de herramienta o tabla del post |
| Espesor de material en el G-code | No declarado; se toma del `.art` (12 mm) | G-code/DXF con espesor, o ficha del job |
| Geometria de toolpath ArtCAM | No decodificada | Dos `.art` diferenciales cambiando una sola variable, o exportacion oficial G-code |
| Formato de `Data2` y `RampData` | Desconocido | Pares controlados de ArtCAM con tipo/estrategia iguales y un parametro distinto |
| Esquema completo de `Parameters` | Parcial; herramienta hallada por texto | Dumps comparativos de dos herramientas con un solo cambio |
| Semantica del dialecto G-code real | Parcialmente inferida | Manual del controlador y un programa reducido exportado por el post identificado |
| Tiempo real de rapidos/cambios | Supuesto de 5000 mm/min y 10 s por M6 | Tiempos medidos en maquina para un programa de prueba |
| Precision de la compensacion escalar de area | 2.17% contra EPS en el corpus | Offset de poligono real o un job con esquinas concavas conocidas |
| Tipos de entrada (rampa/helice/plunge) | El corpus real usa rampa en las 17 entradas | G-code con plunge recto y helices para comparar |
| Compatibilidad del parser con otros `.cnc` | No probada | Corpus de cada post/controlador que se quiera soportar |
| Si `.art` y `.cnc` son del mismo job | Mismo material/espesor/herramienta y dimensiones compatibles; no probado por hash/ID | Exportacion conjunta desde ArtCAM con un ID comun |

No intentar resolver unknowns de ArtCAM mediante ejecucion de macros, binarios
del fabricante, formatos protegidos o bypass de licencia. Preferir exportacion
oficial a G-code/DXF.
