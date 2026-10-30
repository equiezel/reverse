#!/usr/bin/env python3
"""Tabla resumen de las metricas de todos los fixtures.

Uso:
    python tools/research/fixture_report.py out/fx-*.json
"""
import glob
import json
import os
import sys


def main() -> int:
    files = sys.argv[1:] or sorted(glob.glob("out/fx-*.json"))
    if not files:
        print("sin archivos: correr `npm run parse -- <fixture> --json --out out/fx-<n>.json`")
        return 1
    header = f"{'fixture':26} {'cut3D':>9} {'engXY':>9} {'rapid':>9} {'pierce':>7} {'pass':>5} {'ops':>4} {'cov':>5} {'quot':>5} {'seg':>7}"
    print(header)
    print("-" * len(header))
    for f in files:
        m = json.load(open(f, encoding="utf-8"))["metrics"]
        name = os.path.basename(f)
        if name.startswith("fx-"):
            name = name[3:]
        if name.endswith(".json"):
            name = name[:-5]
        print(
            f"{name:26} {m['cutLengthMm']:9.3f} {m['engagedLengthXYMm']:9.3f} {m['rapidLengthMm']:9.3f} "
            f"{m['pierceCount']:7d} {m['passCount']:5d} {m['operationCount']:4d} "
            f"{m['coverage']:5.2f} {str(m['quotable']):>5} {m['estimatedSeconds']:7.2f}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
