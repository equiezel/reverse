#!/usr/bin/env python3
"""Busca pares (x,y) IEEE-754 en cualquier offset y los cruza contra el G-code.

Reporta: cuantos puntos del G-code aparecen en el stream, en que offsets y si el
orden coincide con el del G-code. Sirve para decidir si Data2 guarda polilineas.

Uso:
    python tools/research/pair_probe.py samples/trayectorias.cnc samples/art.art "<stream>"
"""
from __future__ import annotations

import argparse
import re
import struct
from pathlib import Path

import olefile

TOKEN = re.compile(r"([A-Za-z])\s*([-+]?(?:\d+\.?\d*|\.\d+))")


def gcode_points(path: Path, max_z: float = 1.5) -> list[tuple[float, float, float]]:
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
            if z < max_z:
                pts.append((x, y, z))
    return pts


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("cnc", type=Path)
    ap.add_argument("art", type=Path)
    ap.add_argument("stream")
    ap.add_argument("--tol", type=float, default=1e-3)
    ap.add_argument("--precision", choices=["f64", "f32"], default="f64")
    args = ap.parse_args()

    ole = olefile.OleFileIO(args.art)
    data = ole.openstream(tuple(args.stream.split("/"))).read()
    pts = gcode_points(args.cnc)

    # indice de pares (x,y) en cualquier offset, redondeados a 1e-3
    buckets: dict[tuple[int, int], list[int]] = {}
    fmt = "<dd" if args.precision == "f64" else "<ff"
    step = 8 if args.precision == "f64" else 4
    for o in range(0, len(data) - (2 * step - 1)):
        x, y = struct.unpack_from(fmt, data, o)
        if not (-1e4 < x < 1e4 and -1e4 < y < 1e4):
            continue
        key = (round(x * 1000), round(y * 1000))
        buckets.setdefault(key, []).append(o)

    found = []
    for (x, y, z) in pts:
        key = (round(x * 1000), round(y * 1000))
        offs = buckets.get(key, [])
        found.append(offs)

    hits = sum(1 for f in found if f)
    print(f"gcode cut points={len(pts)}  stream={len(data)}B  puntos hallados={hits} ({hits*100.0/len(pts):.1f}%)")
    mono = 0
    last = -1
    for f in found:
        if f:
            o = f[0]
            if o > last:
                mono += 1
                last = o
    print(f"orden monotomico (primera ocurrencia): {mono}/{hits}")
    for i, ((x, y, z), f) in enumerate(zip(pts, found)):
        if i >= 40:
            break
        print(f"  #{i:4d} X{x:8.3f} Y{y:8.3f} Z{z:7.3f} -> {[hex(o) for o in f[:3]]}")
    ole.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
