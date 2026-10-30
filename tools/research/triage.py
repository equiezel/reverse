#!/usr/bin/env python3
"""Triage de archivos: firma, texto/binario, entropia, strings, hexdump.

Uso:
    python tools/research/triage.py samples/art.art samples/1.eps
    python tools/research/triage.py samples/*.cnc --json out/triage.json

Solo lectura. No ejecuta nada del archivo analizado.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from pathlib import Path

SIGNATURES: list[tuple[bytes, str]] = [
    (b"PK\x03\x04", "ZIP / OOXML"),
    (b"PK\x05\x06", "ZIP vacio"),
    (b"PK\x07\x08", "ZIP (spanned)"),
    (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "OLE2 / Compound File Binary"),
    (b"SQLite format 3\x00", "SQLite 3"),
    (b"%PDF-", "PDF"),
    (b"%!PS-Adobe", "PostScript / EPS"),
    (b"\x1f\x8b\x08", "gzip"),
    (b"\x78\x9c", "zlib (best/fast)"),
    (b"\x78\x01", "zlib (no/low compression)"),
    (b"\x78\xda", "zlib (best)"),
    (b"\x28\xb5\x2f\xfd", "zstd"),
    (b"\x04\x22\x4d\x18", "lz4 (legacy)"),
    (b"\xfd7zXZ\x00", "xz"),
    (b"Rar!\x1a\x07", "RAR"),
    (b"7z\xbc\xaf\x27\x1c", "7-Zip"),
    (b"\x1f\x9d", "compress (.Z)"),
    (b"BZh", "bzip2"),
    (b"MZ", "PE / DOS executable"),
    (b"\x7fELF", "ELF executable"),
    (b"{\\rtf", "RTF"),
    (b"\x89PNG", "PNG"),
    (b"\xff\xd8\xff", "JPEG"),
    (b"II*\x00", "TIFF little-endian"),
    (b"MM\x00*", "TIFF big-endian"),
    (b"BM", "BMP (debil: 2 bytes)"),
    (b"\x00\x00\x01\x00", "ICO/CUR"),
    (b"GIF8", "GIF"),
]

ARTIFACT_HINTS = [
    "ArtCAM", "Delcam", "EnRoute", "SAi", "Vectric", "Aspire", "VCarve",
    "Mastercam", "BIESSE", "Biesse", "WoodWOP", "Homag", "HOMAG", "SCM",
    "Mach2", "Mach3", "GRBL", "LinuxCNC", "Fanuc", "FANUC", "Haas", "HAAS",
    "Post", "postp", "XML", "<?xml", "MACHINE", "TOOL", "MATERIAL",
]


def shannon_entropy(data: bytes) -> float:
    if not data:
        return 0.0
    counts = [0] * 256
    for b in data:
        counts[b] += 1
    n = len(data)
    ent = 0.0
    for c in counts:
        if c:
            p = c / n
            ent -= p * math.log2(p)
    return ent


def ascii_strings(data: bytes, minimum: int = 6) -> list[str]:
    pattern = rb"[\x20-\x7e]{%d,}" % minimum
    return [m.group(0).decode("ascii") for m in re.finditer(pattern, data)]


def utf16le_strings(data: bytes, minimum: int = 6) -> list[str]:
    out: list[str] = []
    i = 0
    n = len(data)
    cur: list[str] = []
    while i + 1 < n:
        lo, hi = data[i], data[i + 1]
        if hi == 0 and 0x20 <= lo <= 0x7E:
            cur.append(chr(lo))
        else:
            if len(cur) >= minimum:
                out.append("".join(cur))
            cur = []
        i += 2
    if len(cur) >= minimum:
        out.append("".join(cur))
    return out


def utf16be_strings(data: bytes, minimum: int = 6) -> list[str]:
    out: list[str] = []
    i = 0
    n = len(data)
    cur: list[str] = []
    while i + 1 < n:
        hi, lo = data[i], data[i + 1]
        if hi == 0 and 0x20 <= lo <= 0x7E:
            cur.append(chr(lo))
        else:
            if len(cur) >= minimum:
                out.append("".join(cur))
            cur = []
        i += 2
    if len(cur) >= minimum:
        out.append("".join(cur))
    return out


def signature(data: bytes) -> tuple[str, str | None]:
    for sig, name in SIGNATURES:
        if data.startswith(sig):
            return name, sig.hex()
    return "desconocida", None


def text_analysis(data: bytes) -> dict:
    bom = None
    for sig, name in ((b"\xef\xbb\xbf", "utf-8-sig"), (b"\xff\xfe", "utf-16-le"), (b"\xfe\xff", "utf-16-be")):
        if data.startswith(sig):
            bom = name
    head = data[: 1 << 16]
    printable = sum(1 for b in head if b in (9, 10, 13) or 32 <= b <= 126)
    ratio = printable / max(1, len(head))
    try:
        head.decode("utf-8")
        utf8 = True
    except UnicodeDecodeError:
        utf8 = False
    crlf = data.count(b"\r\n")
    lf = data.count(b"\n") - crlf
    cr = data.count(b"\r") - crlf
    return {
        "bom": bom,
        "utf8_decodable_head": utf8,
        "printable_ratio_head": round(ratio, 4),
        "likely_text": ratio > 0.95,
        "line_endings": {"crlf": crlf, "lf": lf, "cr": cr},
        "lines": len(data.splitlines()),
    }


def hexdump(data: bytes, limit: int = 512) -> list[str]:
    lines = []
    for off in range(0, min(limit, len(data)), 16):
        chunk = data[off: off + 16]
        hexpart = " ".join(f"{b:02x}" for b in chunk)
        asc = "".join(chr(b) if 32 <= b <= 126 else "." for b in chunk)
        lines.append(f"{off:08x}  {hexpart:<47}  {asc}")
    return lines


def entropy_blocks(data: bytes, block: int = 256) -> list[dict]:
    out = []
    for i in range(0, len(data), block):
        chunk = data[i: i + block]
        out.append({"offset": i, "len": len(chunk), "h": round(shannon_entropy(chunk), 3)})
    return out


def summarize(path: Path) -> dict:
    data = path.read_bytes()
    sig_name, sig_hex = signature(data)
    text = text_analysis(data)
    ascii_s = ascii_strings(data)
    u16le = utf16le_strings(data)
    u16be = utf16be_strings(data)

    joined = "\n".join(ascii_s) + "\n" + "\n".join(u16le) + "\n" + "\n".join(u16be)
    hints = sorted({h for h in ARTIFACT_HINTS if h.lower() in joined.lower()})

    blocks = entropy_blocks(data)
    hs = [b["h"] for b in blocks]
    return {
        "file": path.as_posix(),
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "magic": sig_name,
        "magic_hex": sig_hex,
        "text": text,
        "entropy": {
            "overall": round(shannon_entropy(data), 3),
            "min_block": min(hs) if hs else 0,
            "max_block": max(hs) if hs else 0,
            "mean_block": round(sum(hs) / len(hs), 3) if hs else 0,
            "blocks": blocks,
        },
        "strings_ascii_count": len(ascii_s),
        "strings_ascii_sample": ascii_s[:80],
        "strings_utf16le_count": len(u16le),
        "strings_utf16le_sample": u16le[:40],
        "strings_utf16be_count": len(u16be),
        "strings_utf16be_sample": u16be[:40],
        "producer_hints": hints,
        "hexdump_first_512": hexdump(data, 512),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--json", type=Path, default=None, help="Escribe el resultado completo en JSON")
    args = ap.parse_args()

    results = []
    for f in args.files:
        if not f.exists():
            print(f"!! no existe: {f}", file=sys.stderr)
            continue
        r = summarize(f)
        results.append(r)
        print(f"=== {r['file']} ===")
        print(f"size      : {r['size']}")
        print(f"sha256    : {r['sha256']}")
        print(f"magic     : {r['magic']} ({r['magic_hex']})")
        print(f"text?     : {r['text']['likely_text']}  printable={r['text']['printable_ratio_head']}  utf8={r['text']['utf8_decodable_head']}  bom={r['text']['bom']}")
        print(f"lines     : {r['text']['lines']}  eol={r['text']['line_endings']}")
        e = r["entropy"]
        print(f"entropy   : overall={e['overall']} block[min/mean/max]={e['min_block']}/{e['mean_block']}/{e['max_block']}")
        print(f"hints     : {', '.join(r['producer_hints']) or '-'}")
        print(f"strings   : ascii={r['strings_ascii_count']} utf16le={r['strings_utf16le_count']} utf16be={r['strings_utf16be_count']}")
        print("--- hexdump (512) ---")
        print("\n".join(r["hexdump_first_512"]))
        print()

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"[json] {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
