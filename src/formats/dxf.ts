/**
 * Lector DXF ASCII minimo para geometria de control (Fase 4).
 *
 * Soporta LINE, LWPOLYLINE (con bulge), POLYLINE/VERTEX, ARC, CIRCLE y
 * aproxima SPLINE por sus puntos de control (se reporta como advertencia).
 * No es un parser DXF completo: alcanza para comparar longitud y bbox.
 */

export interface DxfGeometry {
  entityCount: number;
  lengthMm: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null;
  unsupported: string[];
}

type Pair = { code: number; value: string };

function pairs(text: string): Pair[] {
  const lines = text.split(/\r\n|\n|\r/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i]!.trim(), 10);
    if (!Number.isFinite(code)) {
      i -= 1;
      continue;
    }
    out.push({ code, value: lines[i + 1]!.trim() });
  }
  return out;
}

export function parseDxf(text: string): DxfGeometry {
  const items = pairs(text);
  let i = 0;
  let inEntities = false;
  const unsupported = new Set<string>();
  let entityCount = 0;
  let lengthMm = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const track = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  while (i < items.length) {
    const p = items[i]!;
    if (p.code === 0 && p.value === 'SECTION') {
      const name = items[i + 1];
      inEntities = name?.code === 2 && name.value === 'ENTITIES';
      i += 2;
      continue;
    }
    if (p.code === 0 && p.value === 'ENDSEC') {
      inEntities = false;
      i++;
      continue;
    }
    if (!inEntities || p.code !== 0) {
      i++;
      continue;
    }
    const type = p.value;
    i++;
    const props: Array<Pair> = [];
    while (i < items.length && items[i]!.code !== 0) {
      props.push(items[i]!);
      i++;
    }
    const nums = (code: number): number[] => props.filter((q) => q.code === code).map((q) => Number.parseFloat(q.value));
    const first = (code: number): number => nums(code)[0] ?? Number.NaN;

    if (type === 'LINE') {
      entityCount++;
      const x1 = first(10);
      const y1 = first(20);
      const x2 = first(11);
      const y2 = first(21);
      lengthMm += Math.hypot(x2 - x1, y2 - y1);
      track(x1, y1);
      track(x2, y2);
    } else if (type === 'LWPOLYLINE') {
      entityCount++;
      const xs = nums(10);
      const ys = nums(20);
      const bulges = nums(42);
      const closed = (Math.trunc(first(70)) & 1) === 1;
      const pts = xs.map((x, k) => ({ x, y: ys[k] ?? Number.NaN }));
      polyline(pts, bulges, closed, (d) => (lengthMm += d), track);
    } else if (type === 'POLYLINE') {
      const closed = (Math.trunc(first(70)) & 1) === 1;
      const verts: Array<{ x: number; y: number }> = [];
      const bulges: number[] = [];
      i++;
      while (i < items.length) {
        const q = items[i]!;
        if (q.code === 0 && q.value === 'VERTEX') {
          i++;
          const vp: Pair[] = [];
          while (i < items.length && items[i]!.code !== 0) {
            vp.push(items[i]!);
            i++;
          }
          verts.push({ x: Number.parseFloat(vp.find((z) => z.code === 10)?.value ?? 'NaN'), y: Number.parseFloat(vp.find((z) => z.code === 20)?.value ?? 'NaN') });
          bulges.push(Number.parseFloat(vp.find((z) => z.code === 42)?.value ?? '0'));
          continue;
        }
        if (q.code === 0 && q.value === 'SEQEND') {
          i++;
          break;
        }
        break;
      }
      if (verts.length >= 2) {
        entityCount++;
        polyline(verts, bulges, closed, (d) => (lengthMm += d), track);
      }
    } else if (type === 'ARC') {
      entityCount++;
      const cx = first(10);
      const cy = first(20);
      const r = first(40);
      const a0 = (first(50) * Math.PI) / 180;
      let a1 = (first(51) * Math.PI) / 180;
      while (a1 <= a0) a1 += 2 * Math.PI;
      lengthMm += r * (a1 - a0);
      for (let k = 0; k <= 32; k++) {
        const a = a0 + ((a1 - a0) * k) / 32;
        track(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
    } else if (type === 'CIRCLE') {
      entityCount++;
      const cx = first(10);
      const cy = first(20);
      const r = first(40);
      lengthMm += 2 * Math.PI * r;
      track(cx - r, cy - r);
      track(cx + r, cy + r);
    } else if (type === 'SPLINE') {
      entityCount++;
      unsupported.add('SPLINE aproximada por puntos de control');
      const xs = nums(10);
      const ys = nums(20);
      for (let k = 0; k + 1 < xs.length; k++) {
        lengthMm += Math.hypot(xs[k + 1]! - xs[k]!, ys[k + 1]! - ys[k]!);
      }
      xs.forEach((x, k) => track(x, ys[k] ?? Number.NaN));
    } else if (type !== 'SEQEND' && type !== 'VERTEX') {
      unsupported.add(type);
    }
  }

  const bbox = Number.isFinite(minX)
    ? { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
    : null;
  return { entityCount, lengthMm, bbox, unsupported: [...unsupported] };
}

function polyline(
  pts: Array<{ x: number; y: number }>,
  bulges: number[],
  closed: boolean,
  addLength: (d: number) => void,
  track: (x: number, y: number) => void,
): void {
  const list = closed ? [...pts, pts[0]!] : pts;
  for (const p of pts) track(p.x, p.y);
  for (let k = 0; k + 1 < list.length; k++) {
    const a = list[k]!;
    const b = list[k + 1]!;
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    const bulge = bulges[k] ?? 0;
    if (Math.abs(bulge) < 1e-12) {
      addLength(chord);
      continue;
    }
    // bulge = tan(theta/4); theta con signo
    const theta = 4 * Math.atan(bulge);
    const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
    addLength(Math.abs(r * theta));
    // muestreo para bbox
    const a0 = Math.atan2(a.y - (a.y + b.y) / 2, a.x - (a.x + b.x) / 2);
    void a0;
    for (let s = 0; s <= 16; s++) {
      const t = s / 16;
      const mt = 1 - t;
      // aproximacion por bezier parabolica del arco
      const midx = (a.x + b.x) / 2 - (b.y - a.y) * (bulge / 2);
      const midy = (a.y + b.y) / 2 + (b.x - a.x) * (bulge / 2);
      track(mt * mt * a.x + 2 * mt * t * midx + t * t * b.x, mt * mt * a.y + 2 * mt * t * midy + t * t * b.y);
    }
  }
}
