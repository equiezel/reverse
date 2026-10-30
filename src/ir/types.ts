/**
 * IR independiente de Bellari.
 *
 * Convenciones (ver docs/02-format-map.md):
 * - Toda coordenada del IR esta normalizada a milimetros, sin importar las
 *   unidades del programa original (`units` conserva la unidad de origen).
 * - Z positivo = arriba del material. Z = 0 es la cara superior del stock.
 * - El parser no conoce precios ni materiales: solo geometria y tiempos.
 */

export type Units = 'mm' | 'inch';

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

export type ToolKind = 'endmill' | 'ball' | 'vbit' | 'drill' | 'other';

export interface CncTool {
  id: string;
  /** Diametro en mm. `null` si el programa no lo declara. */
  diameterMm: number | null;
  kind: ToolKind;
  rpm: number | null;
}

export type OperationKind =
  | 'contour'
  | 'pocket'
  | 'drill'
  | 'engrave'
  | 'vcarve'
  | 'rapid'
  | 'other';

export type PathKind = 'line' | 'arc' | 'polyline';

export interface CncPath {
  kind: PathKind;
  /** Puntos en mm. Para arcos: extremo inicial y final (muestreado en `samples`). */
  points: Vec3[];
  /** Puntos de muestreo para render (solo arcos). */
  samples?: Vec3[];
  /** Avance programado en mm/min. */
  feed?: number;
  /** Solo arcos. */
  clockwise?: boolean;
  closed?: boolean;
  /** Solo arcos: centro en el plano activo. */
  center?: Vec2;
  /** Solo arcos: radio en mm. */
  radius?: number;
  /** Solo arcos: barrido en radianes (siempre >= 0). */
  sweep?: number;
  plane?: 'XY' | 'XZ' | 'YZ';
  /** Longitud 3D del path en mm. */
  length: number;
  /** Longitud proyectada en XY en mm. */
  lengthXY: number;
  /** Longitud efectivamente dentro del material (z <= 0) en mm. */
  engagedLength: number;
  /** Linea del programa donde empieza el path. */
  line: number;
}

export interface CncOperation {
  id: string;
  kind: OperationKind;
  toolId: string | null;
  /** Cantidad de niveles de profundidad distintos con corte lateral. */
  passes: number;
  /** Profundidad maxima alcanzada (valor positivo en mm bajo la cara superior). */
  depthMm: number | null;
  paths: CncPath[];
  /** Linea de inicio/fin en el programa (1-based). */
  startLine: number;
  endLine: number;
  cutLengthMm: number;
  engagedLengthMm: number;
  rapidLengthMm: number;
  pierceCount: number;
  /** true si la operacion se infirio por geometria y no por un comando explicito. */
  inferred: boolean;
}

export interface CncWarning {
  code: string;
  message: string;
  line: number | null;
  severity: 'info' | 'warning' | 'error';
}

export interface Stock {
  /** En mm. */
  width: number;
  height: number;
  thickness: number | null;
  /** Origen del stock en coordenadas del programa (mm). */
  origin?: Vec2;
}

export type SourceFormat = 'gcode' | 'artcam-art' | 'artcam-eps' | 'unknown';

export interface CncSource {
  filename: string;
  format: SourceFormat;
  producer: string | null;
  version: string | null;
  /** Unidad declarada en el programa (no la del IR). */
  units: Units;
}

export interface CncProgram {
  source: CncSource;
  units: Units;
  tools: CncTool[];
  /** Cantidad de bloques M6 interpretados en el programa. */
  toolChangeCount: number;
  operations: CncOperation[];
  /** Movimientos crudos en orden de programa (mm). */
  moves: CncMove[];
  stock: Stock | null;
  warnings: CncWarning[];
  /** 0..1: fraccion de bloques interpretados sin perdida de semantica. */
  coverage: number;
  /** true si se puede cotizar sin revisar (coverage === 1 y sin unknowns). */
  quotable: boolean;
}

export type MoveKind = 'rapid' | 'feed' | 'arc' | 'drill' | 'dwell';

export interface ArcInfo {
  center: Vec2;
  radius: number;
  sweep: number;
  clockwise: boolean;
  plane: 'XY' | 'XZ' | 'YZ';
  /** true si el centro se obtuvo con R en lugar de I/J/K. */
  fromRadius: boolean;
}

export interface CncMove {
  index: number;
  line: number;
  kind: MoveKind;
  from: Vec3;
  to: Vec3;
  lengthMm: number;
  lengthXYMm: number;
  /** Porcion de `lengthMm` con z <= 0. */
  engagedLengthMm: number;
  /** Avance en mm/min. En G93 se normaliza a mm/min equivalente. */
  feedMmMin: number | null;
  /** Segundos estimados del movimiento (sin dwell). */
  seconds: number | null;
  arc: ArcInfo | null;
  toolId: string | null;
  /** Id de operacion asignada (null si es posicionamiento/rapido). */
  operationId: string | null;
  /** true si el movimiento cruza z=0 hacia abajo (entrada al material). */
  pierces: boolean;
  /** true si es un taladrado de ciclo (un agujero). */
  drill: boolean;
}

export interface QuoteMetrics {
  units: 'mm';
  /** Longitud 3D de todos los avances (incluye entradas y rampas). */
  cutLengthMm: number;
  /** Longitud 3D efectivamente bajo z=0. */
  engagedLengthMm: number;
  /** Longitud proyectada en XY de todos los avances. */
  cutLengthXYMm: number;
  /** Longitud proyectada en XY bajo z=0 (metrica 2D para cotizar). */
  engagedLengthXYMm: number;
  rapidLengthMm: number;
  entryFeedLengthMm: number;
  pierceCount: number;
  passCount: number;
  toolChangeCount: number;
  estimatedCutSeconds: number;
  estimatedRapidSeconds: number;
  estimatedSeconds: number;
  timeComplete: boolean;
  bbox: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null;
  minZ: number | null;
  maxZ: number | null;
  thicknessMm: number | null;
  operationCount: number;
  perOperation: Array<{
    id: string;
    kind: OperationKind;
    cutLengthMm: number;
    engagedLengthMm: number;
    pierceCount: number;
    passes: number;
    depthMm: number | null;
  }>;
  warnings: CncWarning[];
  coverage: number;
  quotable: boolean;
  assumptions: string[];
}
