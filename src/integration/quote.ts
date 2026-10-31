/**
 * Adaptador IR -> datos de presupuesto para Bellari/CutQuote.
 *
 * Esta capa NO conoce precios ni catalogo: devuelve magnitudes fisicas y un
 * desglose de tiempo con supuestos explicitos. La capa comercial decide cuanto
 * vale cada minuto, cada mm y cada perforacion.
 *
 * Regla de bloqueo: si la geometria no es confiable (`blockers` no vacio o
 * coverage < 1) el presupuesto no debe calcularse; el objeto lo indica en
 * `quotable` y `quality`.
 */

import type { CncProgram, CncTool, CncWarning, Vec2 } from '../ir/types';
import type { ArtcamProbe } from '../formats/artcam/probe';
import { analyzeTrajectory, summarizeLoops, type CutChain, type TrajectoryAnalysis } from '../analysis/contours';
import { toQuoteMetrics } from '../formats/gcode/metrics';
import type { EpsDocument } from '../formats/eps';
import { epsBbox } from '../formats/eps';

export interface MachineProfile {
  /** Velocidad de rapido real de la maquina, mm/min. */
  rapidRateMmMin: number;
  /** Segundos por cambio de herramienta (M6). */
  toolChangeSeconds: number;
  /** Segundos de arranque/aceleracion del husillo al inicio. */
  spindleStartSeconds: number;
  /**
   * Factor 0..1 sobre el tiempo de movimiento para reflejar aceleraciones,
   * look-ahead y desviaciones del controlador. 1 = sin correccion.
   */
  efficiency: number;
}

export const DEFAULT_MACHINE: MachineProfile = {
  rapidRateMmMin: 5000,
  toolChangeSeconds: 10,
  spindleStartSeconds: 3,
  efficiency: 1,
};

export type TimeReliability = 'measured' | 'estimated' | 'incomplete';

export interface TimeBreakdown {
  /** Corte bajo material (z <= 0). */
  cuttingSeconds: number;
  /** Rampas, helices y aproximaciones por encima de z=0. */
  entrySeconds: number;
  rapidSeconds: number;
  dwellSeconds: number;
  toolChangeSeconds: number;
  spindleSeconds: number;
  /** cutting + entry + rapid + dwell, afectado por `efficiency`. */
  motionSeconds: number;
  totalSeconds: number;
  reliability: TimeReliability;
}

export interface QuoteGeometry {
  bbox: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null;
  /** Perimetro nominal de contornos cerrados, una pasada (mm). */
  contourLengthMm: number;
  /** Longitud de cadenas abiertas (grabados/lineas), una pasada (mm). */
  openLengthMm: number;
  /** Suma de agujeros cerrados. */
  loopCount: number;
  holeCount: number;
  pierceCount: number;
  netAreaMm2: number;
  /**
   * Area de pieza estimada. Si la trayectoria es el centro de herramienta
   * (sin G41/G42) y se conoce el diametro, se descuenta `r * perimetro`.
   * `null` si no se puede estimar con una base geometrica clara.
   */
  partAreaMm2: number | null;
  /** Origen de `netAreaMm2`/`partAreaMm2`. */
  areaBasis: 'tool-center' | 'part-contour' | 'unknown';
  outerAreaMm2: number;
  holeAreaMm2: number;
  bboxAreaMm2: number | null;
}

export interface QuoteMachining {
  /** Longitud 3D real de todos los avances, todas las pasadas. */
  cutLengthMm: number;
  engagedLengthMm: number;
  rapidLengthMm: number;
  /** Niveles de profundidad distintos con corte lateral. */
  passes: number;
  maxDepthMm: number | null;
  thicknessMm: number | null;
  /** Volumen de la pieza (area neta x espesor), si hay espesor. */
  partVolumeMm3: number | null;
  tool: { id: string; diameterMm: number | null; kind: CncTool['kind']; rpm: number | null } | null;
  toolCount: number;
}

export interface QuoteInput {
  schemaVersion: '1';
  /** `machining-program` = trayectoria real; `design-geometry` = contorno 2D sin tiempo. */
  kind: 'machining-program' | 'design-geometry';
  source: CncProgram['source'];
  units: 'mm';
  geometry: QuoteGeometry;
  machining: QuoteMachining;
  time: TimeBreakdown;
  machine: MachineProfile;
  coverage: number;
  quotable: boolean;
  /** false si el tiempo no es confiable (EPS, avance faltante, G95 sin RPM). */
  timeReliable: boolean;
  blockers: string[];
  warnings: CncWarning[];
  assumptions: string[];
  analysis: TrajectoryAnalysis;
}

export interface QuoteOptions {
  machine?: Partial<MachineProfile>;
}

function mergeMachine(profile?: Partial<MachineProfile>): MachineProfile {
  return { ...DEFAULT_MACHINE, ...(profile ?? {}) };
}

/**
 * Aplica metadatos de un .art del mismo trabajo al programa G-code.
 * Solo rellena lo que falta; nunca sobrescribe un valor declarado en el G-code.
 */
export function enrichWithArtcam(program: CncProgram, probe: ArtcamProbe, analysis?: TrajectoryAnalysis): CncProgram {
  const geo = analysis ?? analyzeTrajectory(program);
  const thickness = program.stock?.thickness ?? probe.thicknessMm;
  const toolDiameter = probe.toolpaths.find((t) => t.toolDiameterMm !== null)?.toolDiameterMm ?? null;

  let tools = program.tools;
  if (toolDiameter !== null) {
    tools = tools.map((t, i) => (i === 0 && t.diameterMm === null ? { ...t, diameterMm: toolDiameter } : t));
    if (tools.length === 0) {
      tools = [{ id: 'artcam-t1', diameterMm: toolDiameter, kind: 'endmill', rpm: null }];
    }
  }

  const stock =
    geo.bbox === null
      ? program.stock
      : {
          width: program.stock?.width ?? geo.bbox.width,
          height: program.stock?.height ?? geo.bbox.height,
          thickness,
          origin: program.stock?.origin,
        };

  return { ...program, tools, stock };
}

export function toQuoteInput(program: CncProgram, options: QuoteOptions = {}): QuoteInput {
  const machine = mergeMachine(options.machine);
  const metrics = toQuoteMetrics(program, {
    rapidRateMmMin: machine.rapidRateMmMin,
    toolChangeSeconds: machine.toolChangeSeconds,
  });
  const analysis = analyzeTrajectory(program);

  const cutSeconds = metrics.estimatedCutSeconds;
  const engagedShare = metrics.cutLengthMm > 0 ? metrics.engagedLengthMm / metrics.cutLengthMm : 0;
  const cuttingSeconds = cutSeconds * engagedShare;
  const entrySeconds = Math.max(0, cutSeconds - cuttingSeconds);
  const motionSeconds = (cutSeconds + metrics.estimatedRapidSeconds) * machine.efficiency;

  const toolChangeSeconds = metrics.toolChangeCount * machine.toolChangeSeconds;
  const spindleSeconds = program.moves.length > 0 ? machine.spindleStartSeconds : 0;
  const dwellSeconds = 0;

  const reliability: TimeReliability = !metrics.timeComplete
    ? 'incomplete'
    : metrics.timeReliable
      ? 'estimated'
      : 'incomplete';

  const thickness = program.stock?.thickness ?? null;
  const tool = program.tools[0] ?? null;

  const assumptions = [...metrics.assumptions];
  if (machine.efficiency !== 1) {
    assumptions.push(`Tiempo de movimiento corregido por eficiencia ${machine.efficiency}.`);
  }
  if (machine.spindleStartSeconds > 0) {
    assumptions.push(`Incluye ${machine.spindleStartSeconds}s de arranque de husillo.`);
  }

  // Base geometrica del area. Sin G41/G42 la trayectoria es el centro de la
  // herramienta: esta desplazada r respecto del contorno de pieza, asi que el
  // area barrida difiere del area real en ~ r * perimetro.
  const usesCutterComp = program.warnings.some((w) => w.code === 'CUTTER_COMP_ACTIVE');
  const radius = tool?.diameterMm != null ? tool.diameterMm / 2 : null;
  const totalPerimeter = analysis.contourPerimeterMm + analysis.openLengthMm;
  let areaBasis: QuoteGeometry['areaBasis'] = usesCutterComp ? 'part-contour' : 'tool-center';
  let partAreaMm2: number | null = analysis.netAreaMm2;
  if (!usesCutterComp) {
    if (radius !== null) {
      partAreaMm2 = Math.max(0, analysis.netAreaMm2 - radius * totalPerimeter);
      assumptions.push(
        `Area de pieza estimada restando r*perimetro (r=${radius} mm): correccion de centro de herramienta a contorno.`,
      );
    } else {
      areaBasis = 'unknown';
      partAreaMm2 = null;
      assumptions.push(
        'Area de pieza no estimable: no se conoce el diametro de herramienta y la trayectoria es el centro de herramienta.',
      );
    }
  }
  assumptions.push(
    'La longitud de contorno es la trayectoria programada (centro de herramienta). Si el CAM no compenso, difiere del contorno nominal en el radio de la fresa.',
  );

  const geometry: QuoteGeometry = {
    bbox: analysis.bbox,
    contourLengthMm: analysis.contourPerimeterMm,
    openLengthMm: analysis.openLengthMm,
    loopCount: analysis.closedLoops.length,
    holeCount: analysis.holeCount,
    pierceCount: analysis.entryCount,
    netAreaMm2: analysis.netAreaMm2,
    partAreaMm2,
    areaBasis,
    outerAreaMm2: analysis.outerAreaMm2,
    holeAreaMm2: analysis.holeAreaMm2,
    bboxAreaMm2: analysis.bboxAreaMm2,
  };

  return {
    schemaVersion: '1',
    kind: 'machining-program',
    source: program.source,
    units: 'mm',
    geometry,
    machining: {
      cutLengthMm: metrics.cutLengthMm,
      engagedLengthMm: metrics.engagedLengthMm,
      rapidLengthMm: metrics.rapidLengthMm,
      passes: metrics.passCount,
      maxDepthMm: analysis.depthMm,
      thicknessMm: thickness,
      partVolumeMm3: thickness !== null && partAreaMm2 !== null ? partAreaMm2 * thickness : null,
      tool: tool
        ? { id: tool.id, diameterMm: tool.diameterMm, kind: tool.kind, rpm: tool.rpm }
        : null,
      toolCount: program.tools.length,
    },
    time: {
      cuttingSeconds,
      entrySeconds,
      rapidSeconds: metrics.estimatedRapidSeconds * machine.efficiency,
      dwellSeconds,
      toolChangeSeconds,
      spindleSeconds,
      motionSeconds,
      totalSeconds: motionSeconds + dwellSeconds + toolChangeSeconds + spindleSeconds,
      reliability,
    },
    machine,
    coverage: program.coverage,
    quotable: program.quotable,
    timeReliable: reliability !== 'incomplete',
    blockers: program.blockers,
    warnings: program.warnings,
    assumptions,
    analysis,
  };
}

export type PartGeometryQuality = 'exact' | 'approximate' | 'unusable';
export interface PartGeometryLike {
  loops: Array<{ points: Vec2[]; closed: true; areaMm2: number; perimeterMm: number }>;
  openChains: Array<{ points: Vec2[]; lengthMm: number }>;
  bbox: QuoteGeometry['bbox'];
  cutLengthMm: number;
  pierceCount: number;
  netAreaMm2: number;
  quality: PartGeometryQuality;
  reason: string | null;
}

/**
 * Conversion opcional a una forma compatible con `PartGeometry`.
 *
 * Solo se debe usar si la interfaz muestra la calidad al usuario: la trayectoria
 * es el centro de herramienta, no el contorno de la pieza, y puede incluir
 * lead-ins, tabs y varias pasadas.
 */
export function toPartGeometryLike(input: QuoteInput): PartGeometryLike {
  const loops = input.analysis.closedLoops.map((c) => ({
    points: c.points,
    closed: true as const,
    areaMm2: c.areaMm2 ?? 0,
    perimeterMm: c.perimeterMm,
  }));
  const openChains = input.analysis.openChains.map((c) => ({ points: c.points, lengthMm: c.perimeterMm }));

  let quality: PartGeometryQuality;
  let reason: string | null = null;
  if (!input.quotable) {
    quality = 'unusable';
    reason = `Geometria no confiable: ${input.blockers.join(', ') || 'coverage incompleto'}`;
  } else if (loops.length === 0) {
    quality = 'unusable';
    reason = 'No se detectaron contornos cerrados';
  } else if (openChains.length > 0) {
    quality = 'approximate';
    reason = `${openChains.length} cadenas abiertas no forman contorno cerrado`;
  } else {
    quality = 'exact';
  }

  return {
    loops,
    openChains,
    bbox: input.geometry.bbox,
    cutLengthMm: input.geometry.contourLengthMm,
    pierceCount: input.geometry.pierceCount,
    netAreaMm2: input.geometry.partAreaMm2 ?? input.geometry.netAreaMm2,
    quality,
    reason,
  };
}

/**
 * Adaptador para EPS: aporta contorno y area, no mecanizado.
 *
 * Un EPS exportado por ArtCAM ("Contour data") describe la geometria 2D del
 * diseno, sin profundidad, avance, herramienta ni pasadas. Sirve para validar
 * el contorno, calcular area/perimetro y detectar agujeros, pero **no** para
 * estimar tiempo de maquina. Por eso `time.reliability` es `incomplete` y la
 * advertencia asociada bloquea solo el tiempo (`block: 'time'`).
 */
export function toEpsQuoteInput(doc: EpsDocument, filename: string, options: QuoteOptions = {}): QuoteInput {
  const machine = mergeMachine(options.machine);
  const loops = doc.paths.filter((p) => p.closed).map((p) => p.points);
  const area = loops.length > 0 ? summarizeLoops(loops) : null;

  const bbox = epsBbox(doc);
  const openLengthMm = Math.max(0, doc.lengthMm - doc.loopPerimeterMm);
  const holeCount = area ? area.depths.filter((d) => d % 2 === 1).length : 0;

  const warnings: CncWarning[] = [];
  if (doc.loopCount === 0) {
    warnings.push({
      code: 'EPS_NO_CLOSED_CONTOURS',
      message: 'El EPS no contiene contornos cerrados: no se puede calcular area de pieza.',
      line: null,
      severity: 'warning',
      block: 'geometry',
    });
  }
  warnings.push({
    code: 'EPS_GEOMETRY_ONLY',
    message:
      'EPS aporta contornos 2D sin profundidad, avance ni herramienta: sirve para perimetro/area, no para tiempo de mecanizado.',
    line: null,
    severity: 'info',
    block: 'time',
  });
  if (doc.unsupported.length > 0) {
    warnings.push({
      code: 'EPS_UNSUPPORTED_OPERATORS',
      message: `Operadores PostScript ignorados: ${doc.unsupported.slice(0, 10).join(', ')}${doc.unsupported.length > 10 ? '...' : ''}`,
      line: null,
      severity: 'info',
      block: 'none',
    });
  }

  const chains: CutChain[] = doc.paths.map((path, i) => ({
    id: `eps-path${i + 1}`,
    operationId: 'eps',
    moveStart: 0,
    moveEnd: 0,
    points: path.points,
    start: path.points[0] ?? { x: 0, y: 0 },
    end: path.points[path.points.length - 1] ?? { x: 0, y: 0 },
    closed: path.closed,
    perimeterMm: path.lengthMm,
    areaMm2: path.areaMm2,
    zTop: 0,
    zBottom: 0,
    depthMm: 0,
    toolId: null,
  }));

  // Se construye a mano (no con analyzeTrajectory) porque un EPS no tiene Z,
  // herramienta ni movimientos de entrada.
  const analysis: TrajectoryAnalysis = {
    chains,
    closedLoops: chains.filter((c) => c.closed),
    openChains: chains.filter((c) => !c.closed),
    loopDepths: area?.depths ?? [],
    outerLoopCount: area ? area.depths.filter((d) => d % 2 === 0).length : 0,
    holeCount,
    contourPerimeterMm: doc.loopPerimeterMm,
    outerAreaMm2: area?.outerAreaMm2 ?? 0,
    holeAreaMm2: area?.holeAreaMm2 ?? 0,
    netAreaMm2: area?.netAreaMm2 ?? 0,
    bboxAreaMm2: bbox ? bbox.width * bbox.height : null,
    openLengthMm,
    entryCount: 0,
    entryTypes: { plunge: 0, ramp: 0, helix: 0, drill: 0 },
    passLevelsMm: [],
    depthMm: null,
    bbox,
  };

  const blockers = [...new Set(warnings.filter((w) => w.block === 'geometry').map((w) => w.code))];
  const quotable = blockers.length === 0 && doc.loopCount > 0;

  return {
    schemaVersion: '1',
    kind: 'design-geometry',
    source: {
      filename,
      format: 'artcam-eps',
      producer: doc.producer,
      version: null,
      units: 'mm',
    },
    units: 'mm',
    geometry: {
      bbox,
      contourLengthMm: doc.loopPerimeterMm,
      openLengthMm,
      loopCount: doc.loopCount,
      holeCount,
      pierceCount: 0,
      netAreaMm2: analysis.netAreaMm2,
      partAreaMm2: analysis.netAreaMm2,
      areaBasis: 'part-contour',
      outerAreaMm2: analysis.outerAreaMm2,
      holeAreaMm2: analysis.holeAreaMm2,
      bboxAreaMm2: analysis.bboxAreaMm2,
    },
    machining: {
      cutLengthMm: 0,
      engagedLengthMm: 0,
      rapidLengthMm: 0,
      passes: 0,
      maxDepthMm: null,
      thicknessMm: null,
      partVolumeMm3: null,
      tool: null,
      toolCount: 0,
    },
    time: {
      cuttingSeconds: 0,
      entrySeconds: 0,
      rapidSeconds: 0,
      dwellSeconds: 0,
      toolChangeSeconds: 0,
      spindleSeconds: 0,
      motionSeconds: 0,
      totalSeconds: 0,
      reliability: 'incomplete',
    },
    machine,
    coverage: 1,
    quotable,
    blockers,
    timeReliable: false,
    warnings,
    assumptions: [
      'EPS de ArtCAM: 1 unidad = 1 mm (el archivo declara `2.834646 scale`, mm -> puntos PostScript).',
      'Solo hay geometria 2D: no hay profundidad, pasadas, avance ni herramienta.',
      'El perimetro corresponde al contorno dibujado; el G-code puede estar compensado al centro de herramienta.',
    ],
    analysis,
  };
}

/** Resumen de una linea para logs/UI. */
export function formatQuoteSummary(input: QuoteInput): string {
  const b = input.geometry.bbox;
  const mm = (v: number) => v.toFixed(2);
  const time = input.timeReliable
    ? `t ${(input.time.totalSeconds / 60).toFixed(2)} min`
    : 't n/d';
  return [
    `${input.source.filename}`,
    input.kind === 'design-geometry' ? 'GEOMETRIA 2D' : 'MECANIZADO',
    `perimetro ${mm(input.geometry.contourLengthMm)} mm`,
    `area ${mm((input.geometry.partAreaMm2 ?? input.geometry.netAreaMm2) / 100)} cm2`,
    `agujeros ${input.geometry.holeCount}`,
    b ? `bbox ${mm(b.width)}x${mm(b.height)}` : 'bbox -',
    time,
    input.quotable ? 'COTIZABLE' : `BLOQUEADO (${input.blockers.join(',') || 'coverage'})`,
  ].join(' | ');
}
