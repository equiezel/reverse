#!/usr/bin/env python3
"""Prueba alineaciones y orden de campos (x,y[,z]) en un stream binario de .art.

Para cada alineacion 0..7 extrae doubles, y mide que fraccion de puntos del
G-code aparece como par/tripla consecutiva (tolerancia configurable).

Uso:
    python tools/research/align_probe.py samples/trayectorias.cnc samples/art.art "<stream>"
"""
from __future__ import annotations

import argparse
import re
import struct
from pathlib import Path

import olefile

TOKEN = re.compile(r"([A-Za-z])\s*([-+]?(?:\d+\.?\d*|\.\d+))")


def gcode_points(path: Path) -> list[tuple[float, float, float]]:
    x = y = z = 0.0
    pts = []
    for raw in path.read_text("ascii", errors="replace").splitlines():
        line = re.sub(r"\([^)]*\)", "", raw.split(";")[0])
        words = TOKEN.findall(line)
        if not words:
            continue
        nx, ny, nz = x, y, z
        for letter, value in words:
            v = float(value)
            if letter == "X":
                nx = v
            elif letter == "Y":
                ny = v
            elif letter == "Z":
                nz = v
        if (nx, ny, nz) != (x, y, z):
            x, y, z = nx, ny, nz
            pts.append((x, y, z))
    return pts


def doubles_at(data: bytes, align: int) -> list[tuple[int, float]]:
    out = []
    for off in range(align, len(data) - 7, 8):
        (v,) = struct.unpack_from("<d", data, off)
        out.append((off, v))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("cnc", type=Path)
    ap.add_argument("art", type=Path)
    ap.add_argument("stream")
    ap.add_argument("--tol", type=float, default=2e-3)
    args = ap.parse_args()

    ole = olefile.OleFileIO(args.art)
    data = ole.openstream(tuple(args.stream.split("/"))).read()
    pts = gcode_points(args.cnc)
    # puntos que realmente estan sobre/bajo el material
    cut = [p for p in pts if p[2] < 1.5]
    print(f"gcode points={len(pts)} cut={len(cut)} stream={len(data)}B tol={args.tol}")

    for align in range(8):
        vals = doubles_at(data, align)
        vv = [v for _, v in vals]
        count_xy = count_xyz = 0
        for (x, y, z) in cut:
            hit_xy = hit_xyz = False
            for i in range(len(vv) - 2):
                if abs(vv[i] - x) <= args.tol and abs(vv[i + 1] - y) <= args.tol:
                    hit_xy = True
                    if abs(vv[i + 2] - z) <= args.tol:
                        hit_xyz = True
                    break
            count_xy += hit_xy
            count_xyz += hit_xyz
        print(f"align={align} xy={count_xy}/{len(cut)} xyz={count_xyz}/{len(cut)}")
    ole.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
