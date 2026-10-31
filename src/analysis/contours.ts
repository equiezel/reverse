/**
 * Analisis geometrico de trayectorias de corte.
 *
 * Objetivo comercial: separar "lo que la maquina recorre" de "lo que es la
 * pieza". Un G-code de router recorre el centro de la herramienta, con
 * entradas, rampas y varias pasadas. Para cotizar hace falta:
 *
 *  - perimetro de contornos cerrados (una pasada)  -> geometria nominal
 *  - area neta (contornos exteriores menos agujeros) -> chapa / nesting
 *  - cantidad de agujeros y de entradas al material -> perforaciones
 *  - longitud real recorrida y pasadas             -> tiempo de maquina
 *
 * El analisis es heuristico y explicito: si una cadena no cierra, se reporta
 * como abierta y no aporta area.
 */

import type { CncMove, CncProgram, Vec2, Vec3 } from '../ir/types';

export type EntryKind = 'plunge' | 'ramp' | 'helix' | 'drill';

export interface CutChain {
  id: string;
  operationId: string | null;
  moveStart: number;
  moveEnd: number;
  /** Polilinea XY en mm, con arcos muestreados. */
  points: Vec2[];
  start: Vec2;
  end: Vec2;
  closed: boolean;
  /** Perimetro XY de la cadena (suma de segmentos). */
  perimeterMm: number;
  /** Area con signo (shoelace). Solo si `closed`. */
  areaMm2: number | null;
  zTop: number;
  zBottom: number;
  depthMm: number;
  toolId: string | null;
}

export interface TrajectoryAnalysis {
  chains: CutChain[];
  closedLoops: CutChain[];
  openChains: CutChain[];
  /** Nivel de anidamiento por loop (0 = solido, 1 = agujero, 2 = isla...). */
  loopDepths: number[];
  outerLoopCount: number;
  holeCount: number;
  /** Perimetro de todos los loops cerrados, una pasada. */
  contourPerimeterMm: number;
  /** Suma de |area| de loops de nivel par (solidos). */
  outerAreaMm2: number;
  /** Suma de |area| de loops de nivel impar (agujeros). */
  holeAreaMm2: number;
  /** outerArea - holeArea, nunca negativo. */
  netAreaMm2: number;
  /** Area del bounding box de corte. */
  bboxAreaMm2: number | null;
  /** Longitud XY de cadenas abiertas (grabados, lineas, lead-outs). */
  openLengthMm: number;
  entryCount: number;
  entryTypes: Record<EntryKind, number>;
  /** Niveles de Z bajo material con desplazamiento lateral, ordenados. */
  passLevelsMm: number[];
  depthMm: number | null;
  bbox: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null;
}

export interface AnalyzeOptions {
  /** Tolerancia para considerar que una cadena cierra, en mm. */
  closeToleranceMm?: number;
}

const EPS = 1e-9;

function xy(z: Vec3): Vec2 {
  return { x: z.x, y: z.y };
}

function dist2(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Area con signo (positiva si el poligono es antihorario). */
export function polygonArea(points: Vec2[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Ray casting clasico. Devuelve true si el punto cae dentro o sobre el borde. */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const len = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    // Los poligonos cerrados suelen repetir el primer punto al final: un
    // segmento de longitud cero haria que cualquier punto parezca "sobre el
    // borde". Se ignora.
    if (len > 1e-18) {
      const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
      // Distancia punto-recta, independiente de la longitud del segmento.
      if (Math.abs(cross) / Math.sqrt(len) < 1e-9) {
        const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
        if (dot >= -1e-9 && dot <= len + 1e-9) return true;
      }
    }
    const intersects = a.y > p.y !== b.y > p.y;
    if (intersects) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

function isCutMove(move: CncMove): boolean {
  if (move.kind === 'dwell' || move.kind === 'rapid') return false;
  // Solo cuenta como corte lo que termina bajo la cara superior. Un retract
  // (termina en z>=0) cierra la cadena.
  return move.to.z < 0;
}

function movePoints(move: CncMove): Vec2[] {
  const raw = move.samples && move.samples.length >= 2 ? move.samples : [move.from, move.to];
  const out: Vec2[] = [];
  for (const p of raw) {
    const q = xy(p);
    const last = out[out.length - 1];
    if (!last || dist2(last, q) > 1e-9) out.push(q);
  }
  return out;
}

/** Agrupa movimientos de corte en cadenas, una por pasada.
 *
 * Reglas:
 *  - un retract (termina en z >= 0) cierra la cadena;
 *  - una nueva entrada al material (`pierces`) cierra la cadena anterior, de
 *    modo que dos pasadas de la misma operacion no se fusionen en un poligono
 *    que se recorre dos veces (el area saldria duplicada);
 *  - la rampa de entrada se descarta del contorno: la cadena empieza en el
 *    primer movimiento lateral a Z constante. Asi el perimetro y el area
 *    corresponden al contorno, no a la helice de entrada.
 */
export function extractCutChains(program: CncProgram, toleranceMm = 0.05): CutChain[] {
  const chains: CutChain[] = [];
  let current: CncMove[] = [];
  /** Z del ultimo tramo lateral a Z constante; null si aun no hay contorno. */
  let stableZ: number | null = null;

  const flush = (): void => {
    if (current.length === 0) return;
    const first = current[0]!;
    const last = current[current.length - 1]!;

    // Primer movimiento lateral a Z constante: inicio del contorno real.
    let contourStart = current.findIndex(
      (m) => m.lengthXYMm > 1e-6 && Math.abs(m.from.z - m.to.z) < 1e-6 && m.to.z < 0,
    );
    if (contourStart < 0) contourStart = 0;
    const contourMoves = current.slice(contourStart);

    const points: Vec2[] = [];
    for (const m of contourMoves) {
      for (const p of movePoints(m)) {
        const prev = points[points.length - 1];
        if (!prev || dist2(prev, p) > 1e-9) points.push(p);
      }
    }
    if (points.length < 2) {
      current = [];
      return;
    }
    const start = points[0]!;
    const end = points[points.length - 1]!;
    const perimeter = contourMoves.reduce((s, m) => s + m.lengthXYMm, 0);
    const closed = dist2(start, end) <= toleranceMm && perimeter > toleranceMm;
    const zs = contourMoves.flatMap((m) => [m.from.z, m.to.z]);
    const zTop = Math.max(...zs);
    const zBottom = Math.min(...zs);
    chains.push({
      id: `chain${chains.length + 1}`,
      operationId: first.operationId,
      moveStart: first.index,
      moveEnd: last.index,
      points,
      start,
      end,
      closed,
      perimeterMm: perimeter,
      areaMm2: closed ? Math.abs(polygonArea(points)) : null,
      zTop,
      zBottom,
      depthMm: Math.max(0, -zBottom),
      toolId: first.toolId,
    });
    current = [];
  };

  for (const move of program.moves) {
    if (!isCutMove(move)) {
      flush();
      stableZ = null;
      continue;
    }
    // Nueva pasada: se desciende por debajo del nivel estable anterior. El
    // tramo descendente (rampa) abre la cadena nueva.
    if (stableZ !== null && move.to.z < stableZ - 1e-3) {
      flush();
      stableZ = null;
    }
    if (move.pierces) {
      flush();
      stableZ = null;
    }
    if (current.length > 0) {
      const prev = current[current.length - 1]!;
      if (prev.operationId !== move.operationId || prev.toolId !== move.toolId) {
        flush();
        stableZ = null;
      }
    }
    if (move.lengthXYMm > 1e-6 && Math.abs(move.from.z - move.to.z) < 1e-6 && move.to.z < 0) {
      stableZ = move.to.z;
    }
    if (current.length === 0 && move.from.z < 0 && move.lengthXYMm > 0) {
      // La cadena ya venia cortando (p.ej. G-code sin retract entre islas).
    }
    current.push(move);
  }
  flush();
  return chains;
}

function chainBboxKey(chain: CutChain): string {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of chain.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const r = (v: number) => Math.round(v * 100) / 100;
  return `${chain.operationId ?? '-'}|${chain.toolId ?? '-'}|${chain.closed}|${r(minX)}|${r(minY)}|${r(maxX)}|${r(maxY)}`;
}

/**
 * Deja una sola cadena por contorno: la de la pasada mas profunda.
 *
 * Un contorno cortado en dos pasadas produce dos cadenas identicas en XY. Para
 * area/perimetro nominales sobra la primera; para profundidad sirve la ultima.
 */
export function selectFinalPasses(chains: CutChain[]): CutChain[] {
  const byContour = new Map<string, CutChain>();
  for (const chain of chains) {
    const key = chainBboxKey(chain);
    const prev = byContour.get(key);
    if (!prev || chain.zBottom < prev.zBottom - 1e-6) byContour.set(key, chain);
  }
  return [...byContour.values()].sort((a, b) => a.moveStart - b.moveStart);
}

function classifyEntry(move: CncMove): EntryKind {  if (move.drill) return 'drill';
  if (move.lengthXYMm <= 0.01) return 'plunge';
  if (move.kind === 'arc') return 'helix';
  return 'ramp';
}

/** Analisis completo orientado a presupuesto. */
export function analyzeTrajectory(program: CncProgram, options: AnalyzeOptions = {}): TrajectoryAnalysis {
  const allChains = extractCutChains(program, options.closeToleranceMm ?? 0.05);
  const chains = selectFinalPasses(allChains);
  const closedLoops = chains.filter((c) => c.closed);
  const openChains = chains.filter((c) => !c.closed);

  // Anidamiento: un loop es agujero si esta dentro de un numero impar de loops.
  const area = summarizeLoops(closedLoops.map((c) => c.points));
  const { outerAreaMm2, holeAreaMm2 } = area;

  const entryTypes: Record<EntryKind, number> = { plunge: 0, ramp: 0, helix: 0, drill: 0 };
  for (const move of program.moves) {
    if (!move.pierces) continue;
    entryTypes[classifyEntry(move)] += 1;
  }

  const levelSet = new Set<string>();
  for (const move of program.moves) {
    if (move.kind === 'rapid' || move.kind === 'dwell') continue;
    if (move.to.z < 0 && move.lengthXYMm > 0) levelSet.add((Math.round(move.to.z * 1000) / 1000).toFixed(3));
  }
  const passLevelsMm = [...levelSet].map(Number).sort((a, b) => a - b);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let has = false;
  for (const move of program.moves) {
    if (move.kind === 'rapid' || move.kind === 'dwell') continue;
    if (move.to.z >= 0 && move.from.z >= 0) continue;
    for (const p of [move.from, move.to]) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
      has = true;
    }
  }
  const bbox = has ? { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY } : null;

  const contourPerimeterMm = closedLoops.reduce((s, c) => s + c.perimeterMm, 0);
  const openLengthMm = openChains.reduce((s, c) => s + c.perimeterMm, 0);
  const deepest = program.moves.reduce((m, x) => (x.kind === 'rapid' || x.kind === 'dwell' ? m : Math.min(m, x.to.z, x.from.z)), 0);

  return {
    chains,
    closedLoops,
    openChains,
    loopDepths: area.depths,
    outerLoopCount: area.depths.filter((d) => d % 2 === 0).length,
    holeCount: area.depths.filter((d) => d % 2 === 1).length,
    contourPerimeterMm,
    outerAreaMm2,
    holeAreaMm2,
    netAreaMm2: Math.max(0, outerAreaMm2 - holeAreaMm2),
    bboxAreaMm2: bbox ? bbox.width * bbox.height : null,
    openLengthMm,
    entryCount: entryTypes.plunge + entryTypes.ramp + entryTypes.helix + entryTypes.drill,
    entryTypes,
    passLevelsMm,
    depthMm: deepest < 0 ? Math.abs(deepest) : null,
    bbox,
  };
}

/** Distancia minima y maxima entre dos nubes de puntos (control de similitud). */
export function bboxDelta(
  a: { width: number; height: number },
  b: { width: number; height: number },
): { dw: number; dh: number } {
  return { dw: a.width - b.width, dh: a.height - b.height };
}

export interface AreaSummary {
  outerAreaMm2: number;
  holeAreaMm2: number;
  netAreaMm2: number;
  /** Nivel de anidamiento: 0 = solido, 1 = agujero, 2 = isla dentro de agujero. */
  depths: number[];
}

/**
 * Calcula area neta de un conjunto de loops cerrados usando anidamiento.
 * No requiere que los loops tengan orientacion coherente.
 */
export function summarizeLoops(loops: Vec2[][]): AreaSummary {
  const areas = loops.map((l) => Math.abs(polygonArea(l)));
  const depths = loops.map((loop, i) => {
    if (loop.length < 3) return 0;
    let depth = 0;
    for (let j = 0; j < loops.length; j++) {
      if (i === j) continue;
      const other = loops[j]!;
      if (other.length < 3) continue;
      const probes = [
        loop[0]!,
        loop[Math.floor(loop.length / 3)] ?? loop[0]!,
        loop[Math.floor((2 * loop.length) / 3)] ?? loop[0]!,
      ];
      const inside = probes.filter((p) => pointInPolygon(p, other)).length;
      if (inside >= 2) depth += 1;
    }
    return depth;
  });

  let outerAreaMm2 = 0;
  let holeAreaMm2 = 0;
  depths.forEach((d, i) => {
    if (d % 2 === 0) outerAreaMm2 += areas[i]!;
    else holeAreaMm2 += areas[i]!;
  });
  return { outerAreaMm2, holeAreaMm2, netAreaMm2: Math.max(0, outerAreaMm2 - holeAreaMm2), depths };
}

export { EPS as ANALYSIS_EPS };
