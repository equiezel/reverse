#!/usr/bin/env python3
"""Busca valores IEEE-754 (f64/f32) en un stream y reporta offsets.

Uso:
    python tools/research/find_values.py samples/art.art "<stream>" 18000 1500 25 18 10
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
    ap.add_argument("values", nargs="+", type=float)
    args = ap.parse_args()

    ole = olefile.OleFileIO(args.file)
    data = ole.openstream(tuple(args.stream.split("/"))).read()
    for v in args.values:
        hits: list[str] = []
        for fmt, name in (("<d", "f64"), ("<f", "f32")):
            pat = struct.pack(fmt, v)
            start = 0
            while True:
                i = data.find(pat, start)
                if i == -1:
                    break
                hits.append(f"{name}@0x{i:x}")
                start = i + 1
        print(f"{v:>10g}: {', '.join(hits) if hits else '(no encontrado)'}")
    ole.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
