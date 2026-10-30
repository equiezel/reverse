%
G21
G90
(rectangulo 100x50, herramienta T3, 1 pasada)
(El G-code no declara diametro; D=3 solo existe en este comentario.)
T3 M6
S18000 M3
G0 X0 Y0 Z5
G1 Z-1 F100
G1 X100 F1000
G1 Y50
G1 X0
G1 Y0
G0 Z5
M5
M30
%
