#!/usr/bin/env python3
"""Parser minimo de EPS/PostScript (solo lectura) para geometria de control.

Soporta moveto/lineto/curveto/closepath, `scale` global y `setrgbcolor`/stroke
como separadores. Aplana curvas de Bezier cubicas para medir longitud.

Uso:
    python tools/research/eps_probe.py samples/1.eps
    python tools/research/eps_probe.py samples/1.eps --svg out/eps.svg
"""
from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path

NUM = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)")


def bezier(p0, p1, p2, p3, steps=32):
    out = []
    for i in range(1, steps + 1):
        t = i / steps
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1]
        out.append((x, y))
    return out


def parse(text: str):
    lines = text.splitlines()
    subpaths: list[list[tuple[float, float]]] = []
    cur: list[tuple[float, float]] = []
    pos = (0.0, 0.0)
    scale = 1.0
    for raw in lines:
        line = raw.split("%")[0] if not raw.startswith("%%") else ""
        if not line.strip():
            continue
        if line.strip() == "scale":
            scale = 1.0
            continue
        parts = line.strip().split()
        if not parts:
            continue
        op = parts[-1]
        args = parts[:-1]
        try:
            nums = [float(a) for a in args]
        except ValueError:
            continue
        if op == "moveto":
            if len(cur) >= 2:
                subpaths.append(cur)
            pos = (nums[0], nums[1])
            cur = [pos]
        elif op == "lineto":
            pos = (nums[0], nums[1])
            cur.append(pos)
        elif op == "curveto":
            p1 = (nums[0], nums[1])
            p2 = (nums[2], nums[3])
            p3 = (nums[4], nums[5])
            cur.extend(bezier(pos, p1, p2, p3))
            pos = p3
        elif op == "closepath":
            if cur and cur[0] != cur[-1]:
                cur.append(cur[0])
            if len(cur) >= 2:
                subpaths.append(cur)
            cur = []
        elif op == "stroke":
            if len(cur) >= 2:
                subpaths.append(cur)
            cur = []
    if len(cur) >= 2:
        subpaths.append(cur)
    return subpaths


def length(pts) -> float:
    return sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("eps", type=Path)
    ap.add_argument("--unit-divisor", type=float, default=1.0, help="dividir coordenadas (1 = mm; 2.834646 = PS pt a mm)")
    ap.add_argument("--svg", type=Path, default=None)
    ap.add_argument("--json", type=Path, default=None)
    ap.add_argument("--steps", type=int, default=64, help="subdivisiones por curva de Bezier")
    args = ap.parse_args()

    text = args.eps.read_text("latin-1")
    paths = parse(text)
    d = args.unit_divisor
    total = 0.0
    xs, ys = [], []
    report = []
    print(f"subpaths={len(paths)}")
    for i, p in enumerate(paths):
        pp = [(x / d, y / d) for x, y in p]
        xs.extend(x for x, _ in pp)
        ys.extend(y for _, y in pp)
        L = length(pp)
        total += L
        bx = (min(x for x, _ in pp), min(y for _, y in pp), max(x for x, _ in pp), max(y for _, y in pp))
        closed = math.dist(pp[0], pp[-1]) < 1e-6
        report.append({"index": i, "points": len(pp), "length": L, "closed": closed, "bbox": list(bx)})
        if i < 12:
            print(f"  #{i:2d} pts={len(pp):4d} len={L:10.3f} closed={closed} bbox=({bx[0]:.2f},{bx[1]:.2f})-({bx[2]:.2f},{bx[3]:.2f})")
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(
            json.dumps(
                {
                    "subpaths": report,
                    "totalLength": total,
                    "bbox": [min(xs), min(ys), max(xs), max(ys)] if xs else None,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"[json] {args.json}")

    if args.svg:
        w = max(xs) - min(xs)
        h = max(ys) - min(ys)
        pad = 5
        parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{min(xs)-pad} {-(max(ys))-pad} {w+2*pad} {h+2*pad}" width="900">']
        parts.append('<g transform="scale(1,-1)" fill="none" stroke="black" stroke-width="0.5">')
        for p in paths:
            pts = [(x / d, y / d) for x, y in p]
            dd = "M" + " L".join(f"{x:.3f},{-y:.3f}" for x, y in pts)
            parts.append(f'<path d="{dd}"/>')
        parts.append("</g></svg>")
        args.svg.parent.mkdir(parents=True, exist_ok=True)
        args.svg.write_text("\n".join(parts), encoding="utf-8")
        print(f"[svg] {args.svg}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
