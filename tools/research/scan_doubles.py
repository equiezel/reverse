#!/usr/bin/env python3
"""Busca runs de doubles "plausibles" (coordenadas) dentro de un stream.

Uso:
    python tools/research/scan_doubles.py samples/art.art "ArtCAM/ToolpathData/<id>/Data2"
    python tools/research/scan_doubles.py samples/art.art "<stream>" --min-run 6 --lo -2000 --hi 2000
"""
from __future__ import annotations

import argparse
import struct
from pathlib import Path

import olefile


def plausible(v: float, lo: float, hi: float) -> bool:
    return v == v and abs(v) < 1e15 and lo <= v <= hi


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file", type=Path)
    ap.add_argument("stream")
    ap.add_argument("--min-run", type=int, default=4)
    ap.add_argument("--lo", type=float, default=-5000)
    ap.add_argument("--hi", type=float, default=5000)
    ap.add_argument("--max-runs", type=int, default=40)
    args = ap.parse_args()

    ole = olefile.OleFileIO(args.file)
    data = ole.openstream(tuple(args.stream.split("/"))).read()

    n = len(data)
    runs: list[tuple[int, list[float]]] = []
    o = 0
    while o + 8 * args.min_run <= n:
        vals: list[float] = []
        p = o
        while p + 8 <= n:
            (v,) = struct.unpack_from("<d", data, p)
            if not plausible(v, args.lo, args.hi):
                break
            vals.append(v)
            p += 8
        if len(vals) >= args.min_run and any(abs(v) > 0.5 for v in vals):
            runs.append((o, vals))
            o = p
        else:
            o += 1

    print(f"stream={args.stream} size={n} runs={len(runs)}")
    for start, vals in runs[: args.max_runs]:
        head = ", ".join(f"{v:.3f}" for v in vals[:9])
        tail = f" ... {vals[-1]:.3f}" if len(vals) > 9 else ""
        print(f"  @0x{start:05x} n={len(vals):5d}  [{head}{tail}]")
    ole.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
