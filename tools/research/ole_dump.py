#!/usr/bin/env python3
"""Lista y extrae los streams de un contenedor OLE2 (CFB). Solo lectura.

Uso:
    python tools/research/ole_dump.py samples/art.art
    python tools/research/ole_dump.py samples/art.art --extract out/art-streams
"""
from __future__ import annotations

import argparse
import hashlib
import math
from pathlib import Path

import olefile


def entropy(data: bytes) -> float:
    if not data:
        return 0.0
    counts = [0] * 256
    for b in data:
        counts[b] += 1
    n = len(data)
    return -sum((c / n) * math.log2(c / n) for c in counts if c)


def printable_head(data: bytes, n: int = 48) -> str:
    chunk = data[:n]
    return "".join(chr(b) if 32 <= b <= 126 else "." for b in chunk)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file", type=Path)
    ap.add_argument("--extract", type=Path, default=None)
    args = ap.parse_args()

    ole = olefile.OleFileIO(args.file)
    print(f"OLE: {args.file}  streams={len(ole.listdir())}")
    print(f"{'name':<48} {'size':>9}  {'entropy':>7}  sha256[:16]        head")
    print("-" * 110)
    for entry in ole.listdir(streams=True, storages=False):
        name = "/".join(entry)
        data = ole.openstream(entry).read()
        safe = "".join(ch if ch.isprintable() and ch not in '\\/:*?"<>|' else f"_{ord(ch):02x}" for ch in name.replace("/", "__"))
        print(f"{name:<48} {len(data):>9}  {entropy(data):>7.3f}  {hashlib.sha256(data).hexdigest()[:16]}  {printable_head(data)}")
        if args.extract:
            args.extract.mkdir(parents=True, exist_ok=True)
            (args.extract / safe).write_bytes(data)
    if args.extract:
        print(f"[extracted] {args.extract}")
    ole.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
