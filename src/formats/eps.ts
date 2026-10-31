/**
 * Lector de EPS/PostScript vectorial (subconjunto seguro y acotado).
 *
 * No ejecuta PostScript: tokeniza y aplica solo los operadores de geometria y
 * transformacion. Todo lo demas se ignora y se reporta como no soportado.
 *
 * Unidades: el EPS de ArtCAM declara `2.834646 scale` (mm -> puntos PostScript).
 * El parser aplica la matriz CTM y convierte el resultado a mm dividiendo por
 * 72/25.4, de modo que sirvan tanto EPS en mm como en puntos.
 *
 * Limites: 8 MB de texto, 2 millones de tokens, 2 millones de puntos. Si se
 * excede, lanza EpsError en lugar de degradar en silencio.
 */

import type { Vec2 } from '../ir/types';
import { polygonArea, summarizeLoops, type AreaSummary } from '../analysis/contours';

export class EpsError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'EpsError';
    this.code = code;
  }
}

export interface EpsPath {
  points: Vec2[];
  closed: boolean;
  lengthMm: number;
  areaMm2: number | null;
}

export interface EpsDocument {
  format: 'eps';
  producer: string | null;
  title: string | null;
  creationDate: string | null;
  /** BoundingBox declarado, en puntos PostScript. */
  bboxPs: [number, number, number, number] | null;
  /** BoundingBox convertido a mm. */
  bboxMm: [number, number, number, number] | null;
  /** BoundingBox real de la geometria parseada, en mm. */
  geometryBboxMm: [number, number, number, number] | null;
  paths: EpsPath[];
  loopCount: number;
  openCount: number;
  pointCount: number;
  lengthMm: number;
  loopPerimeterMm: number;
  area: AreaSummary | null;
  unsupported: string[];
  warnings: string[];
}

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
/** Puntos PostScript por milimetro. */
export const PS_POINTS_PER_MM = 72 / 25.4;
const MM_PER_PS_POINT = 25.4 / 72;

const MAX_TEXT = 8 * 1024 * 1024;
const MAX_TOKENS = 2_000_000;
const MAX_POINTS = 2_000_000;

function mul(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

function apply(m: Matrix, x: number, y: number): Vec2 {
  return {
    x: (m.a * x + m.c * y + m.e) * MM_PER_PS_POINT,
    y: (m.b * x + m.d * y + m.f) * MM_PER_PS_POINT,
  };
}

function cubic(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, out: Vec2[], maxPoints: number): void {
  const approx = Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y) + Math.hypot(p3.x - p2.x, p3.y - p2.y);
  const steps = Math.max(8, Math.min(128, Math.ceil(approx / 0.5)));
  for (let i = 1; i <= steps; i++) {
    if (out.length >= maxPoints) return;
    const t = i / steps;
    const mt = 1 - t;
    out.push({
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
    });
  }
}

function pathLength(points: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

function dscField(text: string, key: string): string | null {
  const re = new RegExp(`^%%${key}:\\s*(.*)$`, 'im');
  const m = re.exec(text);
  return m ? m[1]!.trim() : null;
}

export function parseEps(text: string): EpsDocument {
  if (text.length > MAX_TEXT) throw new EpsError('EPS_TOO_LARGE', `EPS de ${text.length} bytes supera el limite`);
  if (!text.startsWith('%!PS')) throw new EpsError('EPS_BAD_SIGNATURE', 'El archivo no comienza con %!PS');

  const warnings: string[] = [];
  const unsupported = new Set<string>();
  const bboxLine = dscField(text, 'BoundingBox');
  let bboxPs: [number, number, number, number] | null = null;
  if (bboxLine) {
    const nums = bboxLine.split(/\s+/).map(Number).filter((n) => Number.isFinite(n));
    if (nums.length >= 4) bboxPs = [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
  }

  let ctm = IDENTITY;
  const ctmStack: Matrix[] = [];
  const paths: EpsPath[] = [];
  let current: Vec2[] = [];
  let currentPoint: Vec2 | null = null;
  let pointCount = 0;

  const flush = (forceClosed: boolean): void => {
    if (current.length >= 2) {
      const first = current[0]!;
      const last = current[current.length - 1]!;
      // ArtCAM no emite `closepath`: cierra repitiendo el punto inicial. Se
      // detecta por coincidencia de extremos, no por el operador.
      const gap = Math.hypot(first.x - last.x, first.y - last.y);
      const closed = forceClosed || (current.length >= 3 && gap <= 0.01);
      if (closed && gap > 1e-9) current.push({ ...first });
      const pts = current;
      paths.push({
        points: pts,
        closed,
        lengthMm: pathLength(pts),
        areaMm2: closed ? Math.abs(polygonArea(pts)) : null,
      });
    }
    current = [];
    currentPoint = null;
  };

  const tokenRe = /%%[^\n]*|%[^\n]*|[{}[\]<>]|\/[^\s{}[\]<>()]*|\([^)]*\)|[^\s{}[\]<>()]+/g;
  const tokens: string[] = [];
  for (const m of text.matchAll(tokenRe)) {
    const t = m[0];
    if (t.startsWith('%')) continue;
    tokens.push(t);
    if (tokens.length > MAX_TOKENS) throw new EpsError('EPS_TOO_MANY_TOKENS', 'EPS con demasiados tokens');
  }

  const stack: Array<number | string> = [];
  const num = (): number => {
    const v = stack.pop();
    return typeof v === 'number' ? v : 0;
  };
  const overflow = (): void => {
    if (stack.length > 64) stack.length = 0;
  };

  for (const token of tokens) {
    const n = Number(token);
    if (token !== '' && Number.isFinite(n) && !/^[A-Za-z]/.test(token)) {
      if (stack.length < 4096) stack.push(n);
      continue;
    }
    if (token.startsWith('/') || token.startsWith('(') || token === '[' || token === ']' || token === '{' || token === '}' || token === '<<' || token === '>>') {
      // nombres, strings y delimitadores de array/dict: no aportan geometria
      if (token === '[' || token === ']' || token === '<<' || token === '>>') stack.length = 0;
      continue;
    }

    switch (token) {
      case 'moveto': {
        const y = num();
        const x = num();
        if (current.length >= 2) flush(false);
        const p = apply(ctm, x, y);
        current = [p];
        currentPoint = p;
        pointCount++;
        break;
      }
      case 'lineto': {
        const y = num();
        const x = num();
        if (!currentPoint) {
          const p = apply(ctm, x, y);
          current = [p];
          currentPoint = p;
        } else {
          const p = apply(ctm, x, y);
          current.push(p);
          currentPoint = p;
        }
        pointCount++;
        break;
      }
      case 'curveto': {
        const y3 = num();
        const x3 = num();
        const y2 = num();
        const x2 = num();
        const y1 = num();
        const x1 = num();
        if (!currentPoint) break;
        const p1 = apply(ctm, x1, y1);
        const p2 = apply(ctm, x2, y2);
        const p3 = apply(ctm, x3, y3);
        cubic(currentPoint, p1, p2, p3, current, MAX_POINTS);
        pointCount = current.length;
        currentPoint = p3;
        break;
      }
      case 'closepath': {
        if (current.length >= 3) {
          const first = current[0]!;
          const last = current[current.length - 1]!;
          if (Math.hypot(first.x - last.x, first.y - last.y) > 1e-9) current.push({ ...first });
          flush(true);
        } else {
          flush(false);
        }
        break;
      }
      case 'newpath':
        flush(false);
        break;
      case 'stroke':
      case 'fill':
      case 'eofill':
      case 'fillstroke':
        flush(false);
        break;
      case 'gsave':
        ctmStack.push(ctm);
        break;
      case 'grestore':
        ctm = ctmStack.pop() ?? IDENTITY;
        break;
      case 'scale': {
        const sy = num();
        const sx = num();
        ctm = mul(ctm, { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
        break;
      }
      case 'translate': {
        const ty = num();
        const tx = num();
        ctm = mul(ctm, { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty });
        break;
      }
      case 'rotate': {
        const deg = (num() * Math.PI) / 180;
        const cos = Math.cos(deg);
        const sin = Math.sin(deg);
        ctm = mul(ctm, { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
        break;
      }
      case 'concat': {
        const f = num();
        const e = num();
        const d = num();
        const c = num();
        const b = num();
        const a = num();
        ctm = mul(ctm, { a, b, c, d, e, f });
        break;
      }
      default:
        unsupported.add(token);
        stack.length = 0;
        break;
    }
    overflow();
  }
  flush(false);

  if (pointCount > MAX_POINTS) throw new EpsError('EPS_TOO_MANY_POINTS', 'EPS con demasiados puntos');
  if (paths.length === 0) warnings.push('El EPS no contiene subpaths con geometria');

  const closed = paths.filter((p) => p.closed);
  const loops = closed.map((p) => p.points);
  const area = loops.length > 0 ? summarizeLoops(loops) : null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of paths) {
    for (const q of p.points) {
      minX = Math.min(minX, q.x);
      minY = Math.min(minY, q.y);
      maxX = Math.max(maxX, q.x);
      maxY = Math.max(maxY, q.y);
    }
  }
  const geometryBboxMm: [number, number, number, number] | null = Number.isFinite(minX)
    ? [minX, minY, maxX, maxY]
    : null;
  const bboxMm: [number, number, number, number] | null = bboxPs
    ? [bboxPs[0] * MM_PER_PS_POINT, bboxPs[1] * MM_PER_PS_POINT, bboxPs[2] * MM_PER_PS_POINT, bboxPs[3] * MM_PER_PS_POINT]
    : null;

  return {
    format: 'eps',
    producer: dscField(text, 'Creator'),
    title: dscField(text, 'Title'),
    creationDate: dscField(text, 'CreationDate'),
    bboxPs,
    bboxMm,
    geometryBboxMm,
    paths,
    loopCount: closed.length,
    openCount: paths.length - closed.length,
    pointCount: paths.reduce((s, p) => s + p.points.length, 0),
    lengthMm: paths.reduce((s, p) => s + p.lengthMm, 0),
    loopPerimeterMm: closed.reduce((s, p) => s + p.lengthMm, 0),
    area,
    unsupported: [...unsupported],
    warnings,
  };
}

/** Bounding box de la geometria real en el formato de `QuoteMetrics`. */
export function epsBbox(doc: EpsDocument): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null {
  if (!doc.geometryBboxMm) return null;
  const [minX, minY, maxX, maxY] = doc.geometryBboxMm;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
