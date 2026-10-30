#!/usr/bin/env python3
"""Pareo operacion G-code <-> subpath EPS, invariante a traslacion.

Normaliza ambos sistemas por su bbox global (origen en la esquina inferior
izquierda) y compara: tamano del bbox, posicion relativa y longitud.

Hipotesis: el EPS es el contorno nominal y el G-code la trayectoria del centro de
la herramienta desplazada por el radio (Ø3.17 -> 1.585 mm).

Uso:
    python tools/research/compare_eps_ops.py out/trayectorias.ir.json out/eps.json [--passes]
"""
from __future__ import annotations

import json
import statistics
import sys


def main() -> int:
    ir = json.load(open(sys.argv[1], encoding="utf-8"))["program"]
    eps = json.load(open(sys.argv[2], encoding="utf-8"))
    single = "--passes" in sys.argv

    ops = []
    for op in ir["operations"]:
        pts = [(p["x"], p["y"]) for path in op["paths"] for p in path["points"]]
        if not pts:
            continue
        length = op["engagedLengthMm"]
        if single and op["passes"] > 1:
            length /= op["passes"]
        ops.append(
            {
                "id": op["id"],
                "len": length,
                "bbox": (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)),
                "passes": op["passes"],
                "depth": op["depthMm"],
            }
        )

    gx0 = min(o["bbox"][0] for o in ops)
    gy0 = min(o["bbox"][1] for o in ops)
    ex0 = eps["bbox"][0]
    ey0 = eps["bbox"][1]

    subs = []
    for s in eps["subpaths"]:
        b = s["bbox"]
        subs.append(
            {
                "index": s["index"],
                "len": s["length"],
                "w": b[2] - b[0],
                "h": b[3] - b[1],
                "x": b[0] - ex0,
                "y": b[1] - ey0,
            }
        )

    free = {s["index"] for s in subs}
    pairs = []
    for op in ops:
        b = op["bbox"]
        ow, oh = b[2] - b[0], b[3] - b[1]
        ox, oy = b[0] - gx0, b[1] - gy0
        best = None
        for s in subs:
            if s["index"] not in free:
                continue
            cost = abs(ox - s["x"]) + abs(oy - s["y"]) + abs(ow - s["w"]) + abs(oh - s["h"])
            if best is None or cost < best[0]:
                best = (cost, s)
        if best is None:
            continue
        free.discard(best[1]["index"])
        pairs.append((op, best[1], best[0] / 4))

    print(f"pares={len(pairs)}  (G-code ops={len(ops)}, EPS subpaths={len(subs)})")
    print(f"{'op':>4} {'eps':>4} {'err':>7} {'dW':>7} {'dH':>7} {'dX':>7} {'dY':>7} {'lenG':>9} {'lenE':>9} {'ratio':>6} {'p':>2} {'prof':>6}")
    print("-" * 100)
    errs, ratios, dws, dhs = [], [], [], []
    for op, s, d in pairs:
        b = op["bbox"]
        ow, oh = b[2] - b[0], b[3] - b[1]
        ox, oy = b[0] - gx0, b[1] - gy0
        dw, dh, dx, dy = ow - s["w"], oh - s["h"], ox - s["x"], oy - s["y"]
        ratio = op["len"] / s["len"] if s["len"] else 0
        errs.append(d)
        ratios.append(ratio)
        dws.append(dw)
        dhs.append(dh)
        print(
            f"{op['id']:>4} {s['index']:>4} {d:7.3f} {dw:7.3f} {dh:7.3f} {dx:7.3f} {dy:7.3f} "
            f"{op['len']:9.3f} {s['len']:9.3f} {ratio:6.3f} {op['passes']:>2} {str(op['depth']):>6}"
        )
    print()
    print(f"err medio {statistics.mean(errs):.3f} mm  max {max(errs):.3f}")
    print(f"dW medio {statistics.mean(dws):+.3f} mm   dH medio {statistics.mean(dhs):+.3f} mm")
    print(f"ratio longitud medio {statistics.mean(ratios):.3f}  min {min(ratios):.3f}  max {max(ratios):.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
