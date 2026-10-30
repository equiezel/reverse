#!/usr/bin/env python3
"""Compara dos JSON de metricas generados por `npm run parse -- --json`.

Uso:
    python tools/research/compare_metrics.py out/a.json out/b.json
"""
import json
import sys

KEYS = [
    "cutLengthMm",
    "engagedLengthMm",
    "rapidLengthMm",
    "pierceCount",
    "passCount",
    "toolChangeCount",
    "estimatedCutSeconds",
    "estimatedRapidSeconds",
    "estimatedSeconds",
    "minZ",
    "maxZ",
    "operationCount",
]


def main() -> int:
    a = json.load(open(sys.argv[1], encoding="utf-8"))["metrics"]
    b = json.load(open(sys.argv[2], encoding="utf-8"))["metrics"]
    bad = 0
    for k in KEYS:
        same = a[k] == b[k]
        bad += 0 if same else 1
        print(f"{k:22} {a[k]!r:>24} {b[k]!r:>24}  {'OK' if same else 'DIFF'}")
    for k in ("bbox", "thicknessMm"):
        same = a[k] == b[k]
        bad += 0 if same else 1
        print(f"{k:22} {str(a[k]):>24} {str(b[k]):>24}  {'OK' if same else 'DIFF'}")
    print("RESULTADO:", "IGUALES" if bad == 0 else f"{bad} DIFERENCIAS")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
