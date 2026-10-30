#!/usr/bin/env python3
"""Correlaciona coordenadas del G-code con doubles dentro de un stream de toolpath .art.

Toma todos los pares (x,y) del G-code (modal, absoluto) en orden y busca su
representacion IEEE-754 en el stream. Sirve para descubrir el layout de registros.

Uso:
    python tools/research/correlate.py samples/trayectorias.cnc samples/art.art "ArtCAM/ToolpathData/<id>/Data2"
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
    pts: list[tuple[float, float, float]] = []
    for raw in path.read_text("ascii", errors="replace").splitlines():
        line = raw.split(";")[0]
        line = re.sub(r"\([^)]*\)", "", line)
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


def find_all(hay: bytes, needle: bytes) -> list[int]:
    out, i = [], hay.find(needle)
    while i != -1:
        out.append(i)
        i = hay.find(needle, i + 1)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("cnc", type=Path)
    ap.add_argument("art", type=Path)
    ap.add_argument("stream")
    ap.add_argument("--limit", type=int, default=25)
    args = ap.parse_args()

    ole = olefile.OleFileIO(args.art)
    data = ole.openstream(tuple(args.stream.split("/"))).read()
    pts = gcode_points(args.cnc)
    print(f"gcode points={len(pts)} stream={len(data)}B")
    for (x, y, z) in pts[: args.limit]:
        pat = struct.pack("<dd", x, y)
        offs = find_all(data, pat)
        print(f"  X{x:9.3f} Y{y:9.3f} Z{z:8.3f} -> x,y @ {[hex(o) for o in offs[:4]]}")
    ole.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
