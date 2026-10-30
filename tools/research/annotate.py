#!/usr/bin/env python3
"""Anota un stream: para cada offset de 4 bytes muestra u32, i32 y f64.

Uso:
    python tools/research/annotate.py samples/art.art "<stream>" --start 0 --end 128
"""
from __future__ import annotations

import argparse
import struct
from pathlib import Path

import olefile


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file", type=Path)
    ap.add_argument("stream")
    ap.add_argument("--start", type=lambda s: int(s, 0), default=0)
    ap.add_argument("--end", type=lambda s: int(s, 0), default=128)
    args = ap.parse_args()

    ole = olefile.OleFileIO(args.file)
    data = ole.openstream(tuple(args.stream.split("/"))).read()
    print(f"stream={args.stream} size={len(data)}")
    print(f"{'offset':>8}  {'u32':>12}  {'i32':>12}  {'f64':>20}")
    for off in range(args.start, min(args.end, len(data) - 7), 4):
        (u,) = struct.unpack_from("<I", data, off)
        (i,) = struct.unpack_from("<i", data, off)
        (d,) = struct.unpack_from("<d", data, off)
        nice = f"{d:.6g}" if d == d and abs(d) < 1e12 else "nan/inf"
        print(f"{off:#08x}  {u:12d}  {i:12d}  {nice:>20}")
    ole.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
