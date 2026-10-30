/**
 * Interprete G-code (RS-274 / ISO 6983) modal, puro y determinista.
 *
 * Alcance implementado:
 *  - G0/G1/G2/G3, planos G17/G18/G19
 *  - G20/G21 (pulgada/mm), G90/G91 (absoluto/incremental), G90.1/G91.1 (centro de arco)
 *  - Arcos con I/J/K y con R, absolutos e incrementales
 *  - G54..G59 (seleccion); G53/G28/G30/G92 se reportan, sus transformaciones
 *    no estan modeladas
 *  - G4 (dwell), G93/G94/G95 (modo de avance)
 *  - T + M6, S, M3/M4/M5, F
 *  - G40/G41/G42, G43/G44/G49 (se registran; no se aplican offsets desconocidos)
 *  - G81..G89 (ciclos de taladrado) con G80, G98/G99
 *  - comentarios (...), ;, %, numeros de bloque N, checksum *NN
 *
 * Politica de errores:
 *  - lo estructural (archivo gigante, arco imposible) lanza CncParseError;
 *  - lo semantico (codigo no soportado, offset desconocido) emite warning,
 *    baja `coverage` y bloquea la cotizacion automatica.
 */

import type {
  ArcInfo,
  CncMove,
  CncOperation,
  CncPath,
  CncProgram,
  CncTool,
  CncWarning,
  MoveKind,
  Units,
  Vec3,
} from '../../ir/types';

export const DEFAULTS = {
  maxBytes: 32 * 1024 * 1024,
  maxLines: 2_000_000,
  maxMoves: 1_000_000,
  maxOperations: 100_000,
  maxWarnings: 500,
  rapidRateMmMin: 5000,
  toolChangeSeconds: 10,
  defaultFeedMmMin: 1000,
} as const;

export interface ParseOptions {
  filename?: string;
  /** Velocidad de rapido asumida (mm/min) para estimar tiempos G0. */
  rapidRateMmMin?: number;
  /** Segundos por cambio de herramienta. */
  toolChangeSeconds?: number;
  /** Unidad a asumir si el programa no declara G20/G21. */
  defaultUnits?: Units;
  /** Limites para archivos maliciosos. */
  maxBytes?: number;
  maxLines?: number;
  maxMoves?: number;
}

export class CncParseError extends Error {
  readonly code: string;
  readonly line: number | null;

  constructor(code: string, message: string, line: number | null = null) {
    super(message);
    this.name = 'CncParseError';
    this.code = code;
    this.line = line;
  }
}

interface Word {
  letter: string;
  value: number;
  raw: string;
}

type Plane = 'XY' | 'XZ' | 'YZ';
type DistanceMode = 'absolute' | 'incremental';
type FeedMode = 'unitsPerMin' | 'inverseTime' | 'unitsPerRev';

interface State {
  motion: number; // 0..3
  motionSet: boolean;
  plane: Plane;
  units: Units;
  unitsDeclared: boolean;
  distance: DistanceMode;
  arcCenterAbsolute: boolean;
  workOffset: number; // 54..59
  toolLength: number | null; // null = sin G43
  cutterComp: 40 | 41 | 42;
  feedMode: FeedMode;
  feedMmMin: number | null;
  rpm: number | null;
  spindleOn: 'cw' | 'ccw' | 'off';
  tool: string | null;
  pendingTool: string | null;
  cycle: number | null; // G73, G81..G89
  cycleR: number | null;
  cycleZ: number | null;
  cycleReturn: 'initial' | 'r';
  dwellSeconds: number;
  position: Vec3;
}

const EPS = 1e-9;
const TOP = 0; // cara superior del material

const MOTION_CODES = new Set([0, 1, 2, 3]);

function isEmpty(v: number | undefined): boolean {
  return v === undefined || v === null || Number.isNaN(v);
}

function hypot2(a: number, b: number): number {
  return Math.hypot(a, b);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Fraccion de un segmento (interpolando z linealmente) que queda con z <= 0. */
function engagedFraction(z0: number, z1: number): number {
  if (z0 <= TOP && z1 <= TOP) return 1;
  if (z0 > TOP && z1 > TOP) return 0;
  const dz = z1 - z0;
  if (Math.abs(dz) < EPS) return 0;
  const t = (TOP - z0) / dz;
  return clamp01(z0 <= TOP ? t : 1 - t);
}

function round(v: number, decimals = 6): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

function tokenize(line: string): { words: Word[]; clean: string } {
  let clean = line;
  // comentarios ( ... ) pueden repetirse
  let guard = 0;
  while (clean.includes('(') && guard++ < 1000) {
    const start = clean.indexOf('(');
    const end = clean.indexOf(')', start + 1);
    clean = end === -1 ? clean.slice(0, start) : clean.slice(0, start) + ' ' + clean.slice(end + 1);
  }
  const semi = clean.indexOf(';');
  if (semi !== -1) clean = clean.slice(0, semi);
  // checksum *NN
  const star = clean.indexOf('*');
  if (star !== -1) clean = clean.slice(0, star);
  // borrado de bloque
  if (clean.trimStart().startsWith('/')) clean = clean.replace('/', ' ');

  const words: Word[] = [];
  const re = /([A-Za-z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g;
  let match: RegExpExecArray | null;
  let leftover = clean;
  while ((match = re.exec(clean)) !== null) {
    const letter = match[1]!.toUpperCase();
    const value = Number.parseFloat(match[2]!);
    if (!Number.isFinite(value)) continue;
    words.push({ letter, value, raw: match[0] });
  }
  // texto fuera de palabras validas
  leftover = clean.replace(re, ' ').replace(/[A-Za-z]/g, ' ').trim();
  return { words, clean: leftover };
}

function sigDigits(v: number): string {
  return round(v, 6).toFixed(6);
}

export function parseGcode(text: string, options: ParseOptions = {}): CncProgram {
  const filename = options.filename ?? 'program.nc';
  const maxLines = options.maxLines ?? DEFAULTS.maxLines;
  const maxMoves = options.maxMoves ?? DEFAULTS.maxMoves;
  const rapidRate = options.rapidRateMmMin ?? DEFAULTS.rapidRateMmMin;
  const toolChangeSeconds = options.toolChangeSeconds ?? DEFAULTS.toolChangeSeconds;

  if (text.length > (options.maxBytes ?? DEFAULTS.maxBytes)) {
    throw new CncParseError('FILE_TOO_LARGE', `El archivo supera el limite de ${options.maxBytes ?? DEFAULTS.maxBytes} bytes`);
  }

  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > maxLines) {
    throw new CncParseError('TOO_MANY_LINES', `El archivo supera el limite de ${maxLines} lineas`);
  }

  const warnings: CncWarning[] = [];
  const warn = (code: string, message: string, line: number | null, severity: CncWarning['severity'] = 'warning'): void => {
    if (warnings.length >= DEFAULTS.maxWarnings) return;
    warnings.push({ code, message, line, severity });
  };

  const state: State = {
    motion: 0,
    motionSet: false,
    plane: 'XY',
    units: options.defaultUnits ?? 'mm',
    unitsDeclared: false,
    distance: 'absolute',
    arcCenterAbsolute: false,
    workOffset: 54,
    toolLength: null,
    cutterComp: 40,
    feedMode: 'unitsPerMin',
    feedMmMin: null,
    rpm: null,
    spindleOn: 'off',
    tool: null,
    pendingTool: null,
    cycle: null,
    cycleR: null,
    cycleZ: null,
    cycleReturn: 'initial',
    dwellSeconds: 0,
    position: { x: 0, y: 0, z: 0 },
  };

  const moves: CncMove[] = [];
  const tools = new Map<string, CncTool>();
  let totalBlocks = 0;
  let unknownBlocks = 0;
  let uncompensated = 0;
  let toolChanges = 0;
  let programEnded = false;

  const scale = (): number => (state.units === 'inch' ? 25.4 : 1);

  const ensureTool = (id: string): CncTool => {
    let tool = tools.get(id);
    if (!tool) {
      tool = { id, diameterMm: null, kind: 'other', rpm: state.rpm };
      tools.set(id, tool);
    }
    return tool;
  };

  const emit = (kind: MoveKind, to: Vec3, arc: ArcInfo | null, line: number, pierceOverride?: boolean): CncMove => {
    if (moves.length >= maxMoves) {
      throw new CncParseError('TOO_MANY_MOVES', `El programa supera el limite de ${maxMoves} movimientos`, line);
    }
    const from = moves.length === 0 && kind === 'rapid' ? { ...to } : { ...state.position };
    const lengthXY = arc
      ? arc.radius * arc.sweep
      : hypot2(to.x - from.x, to.y - from.y);
    const dz = to.z - from.z;
    const length = Math.hypot(lengthXY, dz);
    const fraction = engagedFraction(from.z, to.z);
    const engaged = length * fraction;

    let seconds: number | null = null;
    let feedMmMin = state.feedMmMin;
    if (kind === 'rapid') {
      seconds = (length / rapidRate) * 60;
      feedMmMin = null;
    } else if (kind === 'feed' || kind === 'arc') {
      if (state.feedMode === 'inverseTime' && state.feedMmMin !== null && state.feedMmMin > 0) {
        // F en 1/min: tiempo = 1/F minutos
        seconds = (1 / state.feedMmMin) * 60;
        feedMmMin = length > EPS ? length / (seconds / 60) : null;
      } else if (state.feedMode === 'unitsPerRev') {
        if (state.rpm !== null && state.rpm > 0 && state.feedMmMin !== null) {
          const perMin = state.feedMmMin * state.rpm;
          seconds = perMin > 0 ? (length / perMin) * 60 : null;
          feedMmMin = perMin;
        } else {
          warn('FEED_UNITS_PER_REV_NO_RPM', 'G95 sin S: no se puede estimar el avance', line);
        }
      } else if (state.feedMmMin !== null) {
        seconds = state.feedMmMin > 0 ? (length / state.feedMmMin) * 60 : null;
      } else if (length > EPS) {
        warn('FEED_MISSING', 'Movimiento de corte sin F: tiempo no estimable', line);
        feedMmMin = DEFAULTS.defaultFeedMmMin;
        seconds = (length / DEFAULTS.defaultFeedMmMin) * 60;
      }
    }

    const pierces =
      pierceOverride ??
      (kind !== 'rapid' && from.z >= TOP && to.z < TOP);

    const move: CncMove = {
      index: moves.length,
      line,
      kind,
      from,
      to: { ...to },
      lengthMm: length,
      lengthXYMm: lengthXY,
      engagedLengthMm: engaged,
      feedMmMin,
      seconds,
      arc,
      toolId: state.tool,
      operationId: null,
      pierces,
      drill: false,
    };
    moves.push(move);
    state.position = { ...to };
    return move;
  };

  const applyG = (code: number, value: number, line: number, words: Word[]): void => {
    switch (code) {
      case 0:
      case 1:
      case 2:
      case 3:
        state.motion = code;
        state.motionSet = true;
        return;
      case 4:
        state.dwellSeconds = value > 0 ? value : 0;
        return;
      case 17:
        state.plane = 'XY';
        return;
      case 18:
        state.plane = 'XZ';
        return;
      case 19:
        state.plane = 'YZ';
        return;
      case 20:
        state.units = 'inch';
        state.unitsDeclared = true;
        return;
      case 21:
        state.units = 'mm';
        state.unitsDeclared = true;
        return;
      case 40:
        state.cutterComp = 40;
        return;
      case 41:
        state.cutterComp = 41;
        warn('CUTTER_COMP_ACTIVE', 'G41 activo: trayectoria programada es la del centro de la herramienta; el contorno real requiere el diametro', line);
        return;
      case 42:
        state.cutterComp = 42;
        warn('CUTTER_COMP_ACTIVE', 'G42 activo: trayectoria programada es la del centro de la herramienta; el contorno real requiere el diametro', line);
        return;
      case 43:
      case 44:
        state.toolLength = 0;
        warn('TOOL_LENGTH_OFFSET', 'G43/G44 con offset desconocido: Z puede estar desplazado respecto de la pieza', line);
        unknownBlocks += 1;
        return;
      case 49:
        state.toolLength = null;
        return;
      case 53:
        warn('MACHINE_COORDS', 'G53 (coordenadas de maquina) interpretado como coordenada de pieza', line);
        unknownBlocks += 1;
        return;
      case 54:
      case 55:
      case 56:
      case 57:
      case 58:
      case 59:
        state.workOffset = code;
        return;
      case 61:
      case 61.1:
      case 64:
        return; // modos de aceleracion/parada exacta: no afectan geometria
      case 73:
      case 81:
      case 82:
      case 83:
      case 85:
      case 86:
      case 89:
        state.cycle = code;
        return;
      case 80:
        state.cycle = null;
        return;
      case 84:
      case 87:
        warn('CYCLE_UNSUPPORTED', `G${code} no implementado: se interpreta como G81`, line);
        state.cycle = 81;
        return;
      case 88:
        warn('CYCLE_UNSUPPORTED', 'G88 no implementado: se interpreta como G82', line);
        state.cycle = 82;
        return;
      case 90:
        state.distance = 'absolute';
        return;
      case 91:
        state.distance = 'incremental';
        return;
      case 90.1:
        state.arcCenterAbsolute = true;
        return;
      case 91.1:
        state.arcCenterAbsolute = false;
        return;
      case 92:
        warn('COORD_SET', 'G92 redefine el origen; el desplazamiento no esta implementado', line);
        unknownBlocks += 1;
        return;
      case 93:
        state.feedMode = 'inverseTime';
        return;
      case 94:
        state.feedMode = 'unitsPerMin';
        return;
      case 95:
        state.feedMode = 'unitsPerRev';
        return;
      case 98:
        state.cycleReturn = 'initial';
        return;
      case 99:
        state.cycleReturn = 'r';
        return;
      default:
        unknownBlocks += 1;
        warn('G_UNSUPPORTED', `G${code} no soportado`, line);
        return;
    }
  };

  const applyM = (code: number, line: number): void => {
    switch (code) {
      case 0:
      case 1:
        return; // parada opcional (no afecta geometria)
      case 2:
      case 30:
        programEnded = true;
        return;
      case 3:
        state.spindleOn = 'cw';
        return;
      case 4:
        state.spindleOn = 'ccw';
        return;
      case 5:
        state.spindleOn = 'off';
        return;
      case 6:
        if (state.pendingTool) state.tool = state.pendingTool;
        if (state.tool) ensureTool(state.tool);
        toolChanges += 1;
        return;
      case 7:
      case 8:
      case 9:
        return; // refrigerante: sin efecto en geometria
      case 48:
      case 49:
        return;
      default:
        unknownBlocks += 1;
        warn('M_UNSUPPORTED', `M${code} no soportado`, line);
    }
  };

  // ---------- arcos ----------
  const arcInfo = (
    from: Vec3,
    to: Vec3,
    ijk: { i?: number; j?: number; k?: number },
    r: number | undefined,
    clockwise: boolean,
    plane: Plane,
    line: number,
  ): ArcInfo => {
    const use = plane === 'XY' ? { u: 'x', v: 'y', cu: 'i', cv: 'j' } : plane === 'XZ' ? { u: 'x', v: 'z', cu: 'i', cv: 'k' } : { u: 'y', v: 'z', cu: 'j', cv: 'k' };
    const u = use.u as 'x' | 'y' | 'z';
    const v = use.v as 'x' | 'y' | 'z';
    const su = from[u];
    const sv = from[v];
    const eu = to[u];
    const ev = to[v];

    const finish = (cu: number, cv: number, fromR: boolean): ArcInfo => {
      const radius = hypot2(su - cu, sv - cv);
      if (radius < EPS) {
        throw new CncParseError('ARC_ZERO_RADIUS', 'Arco con radio cero', line);
      }
      const endRadius = hypot2(eu - cu, ev - cv);
      if (Math.abs(endRadius - radius) > Math.max(0.05, radius * 1e-3)) {
        warn(
          'ARC_ENDPOINT_MISMATCH',
          `Arco inconsistente: |centro->fin| = ${round(endRadius, 4)} mm vs radio ${round(radius, 4)} mm`,
          line,
        );
      }
      let sweep: number;
      const samePoint = hypot2(eu - su, ev - sv) < EPS;
      if (samePoint) {
        sweep = 2 * Math.PI;
      } else {
        let a0 = Math.atan2(sv - cv, su - cu);
        let a1 = Math.atan2(ev - cv, eu - cu);
        let d = a1 - a0;
        if (clockwise) {
          while (d >= -EPS) d -= 2 * Math.PI;
        } else {
          while (d <= EPS) d += 2 * Math.PI;
        }
        sweep = Math.abs(d);
      }
      return { center: { x: cu, y: cv }, radius, sweep, clockwise, plane, fromRadius: fromR };
    };

    if (!isEmpty(r)) {
      const rr = Math.abs(r!);
      const du = eu - su;
      const dv = ev - sv;
      const d = hypot2(du, dv);
      if (d < EPS) {
        throw new CncParseError('ARC_FULL_CIRCLE_R', 'Arco completo no puede definirse solo con R', line);
      }
      if (d > 2 * rr + 1e-6) {
        throw new CncParseError('ARC_RADIUS_TOO_SMALL', `R=${rr} es menor que la mitad de la cuerda (${round(d / 2)})`, line);
      }
      const h = Math.sqrt(Math.max(0, rr * rr - (d / 2) ** 2));
      const mu = (su + eu) / 2;
      const mv = (sv + ev) / 2;
      const nu = -dv / d;
      const nv = du / d;
      const candidates = [
        { cu: mu + nu * h, cv: mv + nv * h },
        { cu: mu - nu * h, cv: mv - nv * h },
      ];
      let best: { cu: number; cv: number; sweep: number } | null = null;
      for (const c of candidates) {
        const info = finish(c.cu, c.cv, true);
        if (!best) {
          best = { ...c, sweep: info.sweep };
          continue;
        }
        const wantMinor = r! > 0;
        const isMinor = info.sweep <= Math.PI + 1e-9;
        if (wantMinor === isMinor) best = { ...c, sweep: info.sweep };
      }
      return finish(best!.cu, best!.cv, true);
    }

    const cu = state.arcCenterAbsolute ? (ijk[use.cu as 'i' | 'j' | 'k'] ?? 0) : su + (ijk[use.cu as 'i' | 'j' | 'k'] ?? 0);
    const cv = state.arcCenterAbsolute ? (ijk[use.cv as 'i' | 'j' | 'k'] ?? 0) : sv + (ijk[use.cv as 'i' | 'j' | 'k'] ?? 0);
    if (isEmpty(ijk[use.cu as 'i' | 'j' | 'k']) && isEmpty(ijk[use.cv as 'i' | 'j' | 'k'])) {
      throw new CncParseError('ARC_NO_CENTER', 'Arco sin I/J/K ni R', line);
    }
    return finish(cu, cv, false);
  };

  const sampleArc = (from: Vec3, to: Vec3, info: ArcInfo): Vec3[] => {
    const { u, v } = info.plane === 'XY' ? { u: 'x' as const, v: 'y' as const } : info.plane === 'XZ' ? { u: 'x' as const, v: 'z' as const } : { u: 'y' as const, v: 'z' as const };
    const su = from[u];
    const sv = from[v];
    const eu = to[u];
    const ev = to[v];
    const a0 = Math.atan2(sv - info.center.y, su - info.center.x);
    const sign = info.clockwise ? -1 : 1;
    const steps = Math.max(2, Math.min(720, Math.ceil((info.sweep * info.radius) / 0.5)));
    const out: Vec3[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = a0 + sign * info.sweep * t;
      const p: Vec3 = { ...from };
      p[u] = info.center.x + info.radius * Math.cos(a);
      p[v] = info.center.y + info.radius * Math.sin(a);
      p.z = from.z + (to.z - from.z) * t;
      if (i === 0) p[u] = su, p[v] = sv;
      if (i === steps) p[u] = eu, p[v] = ev;
      out.push(p);
    }
    return out;
  };

  // ---------- ciclo principal ----------
  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1;
    const rawLine = lines[idx]!;
    if (rawLine.trim() === '' || rawLine.trim() === '%') continue;
    const stripped = rawLine.replace(/\([^)]*\)/g, ' ').replace(/;.*$/, '').trim();
    if (stripped === '' || stripped === '%') continue;

    const { words, clean } = tokenize(rawLine);
    totalBlocks += 1;
    if (clean.length > 0) {
      warn('TEXT_IGNORED', `Texto no interpretado: "${clean.slice(0, 40)}"`, lineNo);
      unknownBlocks += 1;
    }
    if (words.length === 0) continue;
    if (programEnded) {
      unknownBlocks += 1;
      warn('AFTER_PROGRAM_END', 'Contenido despues de M02/M30', lineNo);
      continue;
    }

    const axes: { x?: number; y?: number; z?: number } = {};
    const ijk: { i?: number; j?: number; k?: number } = {};
    let r: number | undefined;
    let p: number | undefined;
    let q: number | undefined;
    let l: number | undefined;
    let motionFromBlock: number | null = null;
    let hadNonModalG = false;
    let hadG92 = false;
    let unknownWord = false;

    // Los modos de unidad/distancia/plano afectan a todo el bloque, no solo a
    // las palabras que aparecen despues de ellos (ISO 6983).
    for (const w of words) {
      if (w.letter !== 'G') continue;
      if ([17, 18, 19, 20, 21, 90, 91, 90.1, 91.1].includes(w.value)) {
        applyG(w.value, w.value, lineNo, words);
      }
    }

    for (const w of words) {
      switch (w.letter) {
        case 'N':
          break;
        case 'G': {
          const code = w.value;
          if (MOTION_CODES.has(code)) {
            motionFromBlock = code;
            state.motion = code;
            state.motionSet = true;
          } else {
            applyG(code, w.value, lineNo, words);
            if (!MOTION_CODES.has(code) && (code === 4 || code === 28 || code === 30 || code === 10 || code === 92)) hadNonModalG = true;
            if (code === 92) hadG92 = true;
          }
          break;
        }
        case 'M':
          applyM(w.value, lineNo);
          break;
        case 'F':
          state.feedMmMin = w.value * scale();
          if (state.feedMode === 'inverseTime') state.feedMmMin = w.value;
          break;
        case 'S':
          state.rpm = w.value;
          break;
        case 'T':
          state.pendingTool = `T${w.value}`;
          ensureTool(`T${w.value}`);
          break;
        case 'X':
          axes.x = w.value * scale();
          break;
        case 'Y':
          axes.y = w.value * scale();
          break;
        case 'Z':
          axes.z = w.value * scale();
          break;
        case 'I':
          ijk.i = w.value * scale();
          break;
        case 'J':
          ijk.j = w.value * scale();
          break;
        case 'K':
          ijk.k = w.value * scale();
          break;
        case 'R':
          r = w.value * scale();
          break;
        case 'P':
          p = w.value;
          break;
        case 'Q':
          q = w.value * scale();
          break;
        case 'L':
          l = w.value;
          break;
        case 'H':
        case 'D':
          break; // offset de longitud / radio de comp: ya advertido arriba
        default:
          unknownWord = true;
          warn('WORD_UNSUPPORTED', `Palabra ${w.letter}${w.value} no soportada`, lineNo);
      }
    }

    if (unknownWord) unknownBlocks += 1;

    const hasAxes = axes.x !== undefined || axes.y !== undefined || axes.z !== undefined;

    // G92 changes the coordinate system; it is not a physical movement.
    // Since its offset is not modeled, do not emit a misleading move.
    if (hadG92) continue;

    // G28/G30: retorno a home (no modelamos posicion de maquina)
    if (hasAxes && rawLine.match(/G\s*28|G\s*30/i) && motionFromBlock === null) {
      unknownBlocks += 1;
      warn('RETURN_HOME', 'G28/G30: posicion de retorno desconocida para el modelo de pieza', lineNo);
      continue;
    }

    // dwell
    if (hadNonModalG && rawLine.match(/G\s*4(?!\d)/i)) {
      const dwell = p ?? 0;
      const move: CncMove = {
        index: moves.length,
        line: lineNo,
        kind: 'dwell',
        from: { ...state.position },
        to: { ...state.position },
        lengthMm: 0,
        lengthXYMm: 0,
        engagedLengthMm: 0,
        feedMmMin: null,
        seconds: dwell,
        arc: null,
        toolId: state.tool,
        operationId: null,
        pierces: false,
        drill: false,
      };
      moves.push(move);
      continue;
    }

    // ciclos de taladrado
    if (state.cycle !== null) {
      if (hasAxes) {
        const target = { ...state.position };
        if (axes.x !== undefined) target.x = axes.x;
        if (axes.y !== undefined) target.y = axes.y;
        if (axes.z !== undefined) state.cycleZ = axes.z;
        const zDepth = state.cycleZ ?? target.z;
        if (state.cycle === 81 || state.cycle === 82 || state.cycle === 73 || state.cycle === 83) {
          if (r !== undefined) state.cycleR = r;
          const rLevel = state.cycleR ?? target.z;
          const initialZ = state.position.z;
          const peck = state.cycle === 83 || state.cycle === 73;
          if (peck && (q === undefined || q <= 0)) {
            warn('CYCLE_PECK_WITHOUT_Q', 'G83/G73 sin Q: se taladra en una pasada', lineNo);
          }
          // rapido al nivel R
          const pos = emit('rapid', { x: target.x, y: target.y, z: rLevel }, null, lineNo);
          pos.drill = true;
          // perforacion
          emit('feed', { x: target.x, y: target.y, z: zDepth }, null, lineNo, true);
          const hole = moves[moves.length - 1]!;
          hole.drill = true;
          // retorno
          emit('rapid', { x: target.x, y: target.y, z: state.cycleReturn === 'initial' ? initialZ : rLevel }, null, lineNo);
          const ret = moves[moves.length - 1]!;
          ret.drill = true;
        } else {
          unknownBlocks += 1;
          warn('CYCLE_UNSUPPORTED', `Ciclo G${state.cycle} no soportado`, lineNo);
        }
      }
      continue;
    }

    // movimiento
    const motion = motionFromBlock ?? (hasAxes ? (state.motionSet ? state.motion : 0) : null);
    if (motion === null) continue;
    if (!hasAxes && motionFromBlock === null) continue;

    const target: Vec3 = { ...state.position };
    if (axes.x !== undefined) target.x = state.distance === 'absolute' ? axes.x : state.position.x + axes.x;
    if (axes.y !== undefined) target.y = state.distance === 'absolute' ? axes.y : state.position.y + axes.y;
    if (axes.z !== undefined) target.z = state.distance === 'absolute' ? axes.z : state.position.z + axes.z;

    if (!state.unitsDeclared) {
      warn('UNITS_ASSUMED', `Programa sin G20/G21: se asume ${state.units}`, lineNo);
      unknownBlocks += 1;
      state.unitsDeclared = true;
    }
    if (state.cutterComp !== 40) {
      uncompensated += 1;
      unknownBlocks += 1;
      warn('CUTTER_COMP_ACTIVE', 'Compensacion G41/G42 activa: la trayectoria no representa el contorno real', lineNo);
    }
    if (motion === 0 || motion === 1) {
      const kind: MoveKind = motion === 0 ? 'rapid' : 'feed';
      if (kind === 'feed' && state.feedMmMin === null) {
        warn('FEED_MISSING', 'Avance F no definido antes del primer corte', lineNo);
      }
      emit(kind, target, null, lineNo);
    } else {
      if (state.feedMmMin === null) warn('FEED_MISSING', 'Avance F no definido antes del arco', lineNo);
      const info = arcInfo(state.position, target, ijk, r, motion === 2, state.plane, lineNo);
      const move = emit('arc', target, info, lineNo);
      const samples = sampleArc(move.from, move.to, info);
      move.arc = info;
      (move as CncMove & { samples?: Vec3[] }).samples = samples;
    }
  }

  if (moves.length === 0) {
    throw new CncParseError('NO_MOVES', 'El archivo no contiene movimientos interpretables');
  }

  const operations = buildOperations(moves);

  const coverage = totalBlocks === 0 ? 0 : Math.max(0, Math.min(1, 1 - unknownBlocks / totalBlocks));
  const hasErrors = warnings.some((w) => w.severity === 'error');
  const program: CncProgram = {
    source: {
      filename,
      format: 'gcode',
      producer: null,
      version: null,
      units: state.units,
    },
    units: state.units,
    tools: [...tools.values()],
    toolChangeCount: toolChanges,
    operations,
    moves,
    stock: null,
    warnings: warnings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0)),
    coverage: round(coverage, 4),
    quotable: unknownBlocks === 0 && !hasErrors,
  };
  return program;
}

/** Agrupa movimientos en operaciones por retraccion/cambio de herramienta. */
export function buildOperations(moves: CncMove[]): CncOperation[] {
  const operations: CncOperation[] = [];
  let current: CncOperation | null = null;
  let pendingEntry = false;

  const close = (): void => {
    if (!current) return;
    const paths = current.paths;
    const zLevels = new Set<string>();
    for (const path of paths) {
      if (path.lengthXY > 0 && Math.abs(path.points[path.points.length - 1]!.z - path.points[0]!.z) < 1e-6) {
        const z = path.points[0]!.z;
        if (z < 0) zLevels.add(sigDigits(z));
      }
    }
    current.passes = Math.max(1, zLevels.size);
    current.cutLengthMm = round(paths.reduce((s, p) => s + p.length, 0));
    current.engagedLengthMm = round(paths.reduce((s, p) => s + p.engagedLength, 0));
    operations.push(current);
    if (operations.length > DEFAULTS.maxOperations) {
      throw new CncParseError('TOO_MANY_OPERATIONS', `Mas de ${DEFAULTS.maxOperations} operaciones`);
    }
    current = null;
  };

  const start = (move: CncMove): CncOperation => {
    const op: CncOperation = {
      id: `op${operations.length + 1}`,
      kind: move.drill ? 'drill' : 'contour',
      toolId: move.toolId,
      passes: 1,
      depthMm: null,
      paths: [],
      startLine: move.line,
      endLine: move.line,
      cutLengthMm: 0,
      engagedLengthMm: 0,
      rapidLengthMm: 0,
      pierceCount: 0,
      inferred: true,
    };
    return op;
  };

  const minZ = { value: Number.POSITIVE_INFINITY };
  const opMinZ = new Map<CncOperation, number>();

  for (const move of moves) {
    if (move.kind === 'rapid') {
      if (current) {
        current.rapidLengthMm += move.lengthMm;
        move.operationId = current.id;
        current.endLine = move.line;
      }
      if (!move.drill && move.to.z >= TOP - EPS) {
        close();
        pendingEntry = true;
      }
      continue;
    }
    if (move.kind === 'dwell') continue;

    if (current && current.toolId !== move.toolId) {
      close();
      pendingEntry = true;
    }
    if (!current) {
      const engaged = move.engagedLengthMm > 0 || move.drill || move.pierces;
      if (!engaged && !pendingEntry) continue;
      current = start(move);
      opMinZ.set(current, Number.POSITIVE_INFINITY);
      pendingEntry = false;
    }

    const op = current;
    const path: CncPath = {
      kind: move.kind === 'arc' ? 'arc' : 'line',
      points: move.kind === 'arc' ? [move.from, move.to] : [move.from, move.to],
      samples: (move as CncMove & { samples?: Vec3[] }).samples,
      feed: move.feedMmMin ?? undefined,
      clockwise: move.arc?.clockwise,
      closed:
        move.kind === 'arc'
          ? Math.hypot(move.to.x - move.from.x, move.to.y - move.from.y) < 1e-6
          : false,
      center: move.arc?.center,
      radius: move.arc?.radius,
      sweep: move.arc?.sweep,
      plane: move.arc?.plane,
      length: move.lengthMm,
      lengthXY: move.lengthXYMm,
      engagedLength: move.engagedLengthMm,
      line: move.line,
    };
    op.paths.push(path);
    move.operationId = op.id;
    op.endLine = move.line;
    if (move.pierces) op.pierceCount += 1;
    if (move.drill) op.kind = 'drill';
    const z = Math.min(move.from.z, move.to.z);
    opMinZ.set(op, Math.min(opMinZ.get(op) ?? Number.POSITIVE_INFINITY, z));
    minZ.value = Math.min(minZ.value, z);
  }
  close();

  for (const op of operations) {
    const z = opMinZ.get(op);
    op.depthMm = z !== undefined && Number.isFinite(z) ? round(Math.max(0, -z), 4) : null;
    op.engagedLengthMm = round(op.engagedLengthMm);
    op.rapidLengthMm = round(op.rapidLengthMm);
  }
  return operations;
}
