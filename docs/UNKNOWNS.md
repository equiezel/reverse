# Unknowns y evidencia necesaria

| Pregunta / campo | Estado | Evidencia que lo resolveria |
|---|---|---|
| Software/version que genero cada `.cnc` | Usuario recuerda ArtCAM 9; no verificado por archivo ni por exportacion | Nombre/version del CAM y confirmacion para cada archivo |
| Marca/modelo de router, controlador y postprocesador | Mach2 es posible segun recuerdo; maquina y post desconocidos | Identificacion de maquina/controlador y archivo de post |
| Unidades efectivas de los dos `.cnc` | Asumidas mm; no declaradas en archivo | Reexportar con unidades declaradas y comparar una dimension conocida |
| Work offsets y origen de pieza | No documentados | Archivo con origen conocido o tabla de offsets del job |
| EPS y G-code son el mismo diseño | No confirmado; dimensiones difieren | DXF/SVG de control del mismo job y origen/escala declarados; usuario puede aportarlo en `samples/` |
| Objetivo de producto | No confirmado: cotizar tiempo, reconstruir pieza o ambos | Prioridad comercial del usuario |
| NDA/permiso de conservar muestras | No confirmado directamente | Confirmacion del usuario y politica de retencion |
| Geometria de toolpath ArtCAM | No decodificada | Dos `.art` diferenciales cambiando una sola variable, o exportacion oficial G-code |
| Formato de `Data2` y `RampData` | Desconocido | Pares controlados de ArtCAM con tipo/estrategia iguales y un parametro distinto |
| Esquema completo de `Parameters` | Parcial; herramienta hallada por texto | Dumps comparativos de dos herramientas con un solo cambio |
| Semantica del dialecto G-code real | Parcialmente inferida | Manual del controlador y un programa reducido exportado por el post identificado |
| Tiempo real de rapidos/cambios | Supuesto de 5000 mm/min y 10 s por M6 | Tiempos medidos en maquina para un programa de prueba |
| Tolerancia/compensacion EPS-DXF-CNC | Desconocida | Exportaciones nominal y mecanizada con diametro y estrategia conocidos |
| Compatibilidad del parser con otros `.cnc` | No probada | Corpus de cada post/controlador que se quiera soportar |

No intentar resolver unknowns de ArtCAM mediante ejecucion de macros, binarios
del fabricante, formatos protegidos o bypass de licencia. Preferir exportacion
oficial a G-code/DXF.
