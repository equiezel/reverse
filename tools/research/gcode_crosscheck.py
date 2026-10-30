#!/usr/bin/env python3
"""Cross-check independiente del parser TypeScript.

Implementacion deliberadamente distinta y simple: modal G0/G1, sin arcos.
Calcula:
  - suma de distancias XY de avances con ambos extremos bajo z<=0
  - cantidad de entradas al material (cruce z: >=0 -> <0)
  - bbox de esos avances
Comparar con `out/*.ir.json` (metrics.engagedLengthXYMm, pierceCount, bbox).

Uso:
    python tools/research/gcode_crosscheck.py samples/trayectorias.cnc
"""
from __future__ import annotations

import math
import re
import sys
from pathlib import Path

WORD = re.compile(r"([A-Za-z])\s*([-+]?(?:\d+\.?\d*|\.\d+))")


def main() -> int:
    path = Path(sys.argv[1])
    x = y = z = 0.0
    motion = 0
    units = 1.0
    total_xy = 0.0
    pierces = 0
    minx = miny = math.inf
    maxx = maxy = -math.inf

    for raw in path.read_text("ascii", errors="replace").splitlines():
        line = re.sub(r"\([^)]*\)", "", raw.split(";")[0])
        words = WORD.findall(line)
        if not words:
            continue
        nx, ny, nz, nf = x, y, z, motion
        for letter, value in words:
            v = float(value)
            if letter == "G":
                if v in (0.0, 1.0):
                    nf = int(v)
                elif v == 20:
                    units = 25.4
                elif v == 21:
                    units = 1.0
            elif letter == "X":
                nx = v * units
            elif letter == "Y":
                ny = v * units
            elif letter == "Z":
                nz = v * units
        moved = (nx, ny, nz) != (x, y, z)
        if moved:
            if nf == 0:
                pass
            elif z >= 0 > nz:
                pierces += 1
            if nf != 0:
                total_xy += math.hypot(nx - x, ny - y)
                if z <= 0 and nz <= 0:
                    minx, maxx = min(minx, x, nx), max(maxx, x, nx)
                    miny, maxy = min(miny, y, ny), max(maxy, y, ny)
        x, y, z = nx, ny, nz
        motion = nf

    print(f"archivo        : {path}")
    print(f"suma XY feeds  : {total_xy:.3f} mm (todos los avances, no solo engaged)")
    print(f"pierces        : {pierces}")
    print(f"bbox (engaged) : {maxx-minx:.3f} x {maxy-miny:.3f} mm  [{minx:.3f},{miny:.3f}]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
