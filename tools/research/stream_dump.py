#!/usr/bin/env python3
"""Dump de un stream de un .art (OLE2) con interpretaciones numericas.

Uso:
    python tools/research/stream_dump.py samples/art.art "ArtCAM/VersionInfo/VersionA"
    python tools/research/stream_dump.py samples/art.art "ArtCAM/Material/MaterialThickness" --doubles
    python tools/research/stream_dump.py samples/art.art "ArtCAM/ToolpathData/#ToolpathList" --offset 0 --length 128
"""
from __future__ import annotations

import argparse
import struct
from pathlib import Path

import olefile


def hexdump(data: bytes, base: int = 0, limit: int | None = None) -> None:
    view = data if limit is None else data[:limit]
    for off in range(0, len(view), 16):
        chunk = view[off: off + 16]
        hexpart = " ".join(f"{b:02x}" for b in chunk)
        asc = "".join(chr(b) if 32 <= b <= 126 else "." for b in chunk)
        print(f"{base + off:08x}  {hexpart:<47}  {asc}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file", type=Path)
    ap.add_argument("stream")
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--length", type=int, default=None)
    ap.add_argument("--hexdump", action="store_true")
    ap.add_argument("--doubles", action="store_true")
    ap.add_argument("--floats", action="store_true")
    ap.add_argument("--u32", action="store_true")
    ap.add_argument("--i32", action="store_true")
    args = ap.parse_args()

    ole = olefile.OleFileIO(args.file)
    entry = tuple(args.stream.split("/"))
    raw = ole.openstream(entry).read()
    data = raw[args.offset: (args.offset + args.length) if args.length else None]
    print(f"stream={args.stream} total={len(raw)} slice=@{args.offset}+{len(data)}")
    print(repr(data[:600]))
    if args.hexdump or not (args.doubles or args.floats or args.u32 or args.i32):
        hexdump(data, args.offset, 1024)
    if args.doubles:
        for i in range(0, len(data) - 7, 8):
            (v,) = struct.unpack_from("<d", data, i)
            if v == v and abs(v) < 1e12:
                print(f"  +{args.offset + i:04x} d={v:g}")
    if args.floats:
        for i in range(0, len(data) - 3, 4):
            (v,) = struct.unpack_from("<f", data, i)
            if v == v and abs(v) < 1e9:
                print(f"  +{args.offset + i:04x} f={v:g}")
    if args.u32:
        for i in range(0, len(data) - 3, 4):
            (v,) = struct.unpack_from("<I", data, i)
            print(f"  +{args.offset + i:04x} u32={v}")
    if args.i32:
        for i in range(0, len(data) - 3, 4):
            (v,) = struct.unpack_from("<i", data, i)
            print(f"  +{args.offset + i:04x} i32={v}")
    ole.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
