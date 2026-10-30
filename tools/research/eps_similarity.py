#!/usr/bin/env python3
"""Chequeo de similitud EPS vs G-code.

Una similitud (rotacion + escala uniforme + traslacion) preserva la relacion de
aspecto. Si los aspect ratios difieren, o las escalas X e Y necesarias difieren
mucho, los dibujos no son el mismo objeto.

Uso:
    python tools/research/eps_similarity.py out/trayectorias.ir.json out/eps.json
"""
from __future__ import annotations

import json
import sys


def main() -> int:
    ir = json.load(open(sys.argv[1], encoding="utf-8"))["program"]
    eps = json.load(open(sys.argv[2], encoding="utf-8"))

    xs: list[float] = []
    ys: list[float] = []
    engaged = 0.0
    for op in ir["operations"]:
        engaged += op["engagedLengthMm"]
        for path in op["paths"]:
            for p in path["points"]:
                xs.append(p["x"])
                ys.append(p["y"])

    gw, gh = max(xs) - min(xs), max(ys) - min(ys)
    eb = eps["bbox"]
    ew, eh = eb[2] - eb[0], eb[3] - eb[1]
    elen = eps["totalLength"]

    sx, sy = gw / ew, gh / eh
    print(f"G-code bbox      : {gw:.3f} x {gh:.3f}   aspect {gw / gh:.4f}")
    print(f"EPS bbox (raw)   : {ew:.3f} x {eh:.3f}   aspect {ew / eh:.4f}")
    print(f"escala necesaria : X {sx:.4f}  Y {sy:.4f}  (desbalance {abs(sx / sy - 1) * 100:.2f}%)")
    print(f"longitud G-code  : {engaged:.3f}   EPS {elen:.3f}   ratio {engaged / elen:.4f}")
    print(f"subpaths EPS     : {len(eps['subpaths'])}   operaciones {len(ir['operations'])}")

    ok = abs(sx / sy - 1) < 0.02 and abs(engaged / elen - sx) < 0.02 * sx
    print()
    print("VEREDICTO:", "compatible con similitud" if ok else "NO es la misma geometria (o no es similitud)")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
