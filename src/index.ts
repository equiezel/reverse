/**
 * Superficie publica del importador de trayectorias CNC.
 *
 * Todo lo exportado aca es TypeScript puro y corre en navegador: no usa
 * `fs`, `path`, `crypto` ni ejecuta contenido de los archivos.
 *
 * Flujo recomendado:
 *
 * ```ts
 * import { detectFormat, parseGcode, toQuoteInput, toPartGeometryLike } from './src';
 *
 * const detection = detectFormat(bytes);
 * if (detection.kind === 'gcode') {
 *   const program = parseGcode(text, { filename });
 *   const quote = toQuoteInput(program, { machine: { rapidRateMmMin: 6000 } });
 *   if (!quote.quotable) showBlockers(quote.blockers, quote.warnings);
 *   const geometry = toPartGeometryLike(quote); // opcional
 * }
 * ```
 */

export type {
  ArcInfo,
  CncMove,
  CncOperation,
  CncPath,
  CncProgram,
  CncSource,
  CncTool,
  CncWarning,
  MoveKind,
  OperationKind,
  PathKind,
  QuoteMetrics,
  SourceFormat,
  Stock,
  ToolKind,
  Units,
  Vec2,
  Vec3,
  WarningBlock,
} from './ir/types';

export { parseGcode, buildOperations, blockFor, CncParseError, DEFAULTS } from './formats/gcode/parse';
export type { ParseOptions } from './formats/gcode/parse';
export { toQuoteMetrics } from './formats/gcode/metrics';
export type { MetricsOptions } from './formats/gcode/metrics';
export { renderSvg } from './formats/gcode/render';
export type { RenderOptions } from './formats/gcode/render';

export { detectFormat } from './formats/detect';
export type { DetectedKind, Detection } from './formats/detect';

export { parseDxf } from './formats/dxf';
export type { DxfGeometry } from './formats/dxf';

export { parseEps, epsBbox, EpsError, PS_POINTS_PER_MM } from './formats/eps';
export type { EpsDocument, EpsPath } from './formats/eps';

export { CompoundFile, CfbError } from './formats/artcam/cfb';
export type { CfbEntry } from './formats/artcam/cfb';
export {
  probeArtcam,
  parseToolpathList,
  parseUnicodeToolpathList,
  extractToolDescription,
} from './formats/artcam/probe';
export type { ArtcamProbe, ArtcamToolpathInfo } from './formats/artcam/probe';

export {
  analyzeTrajectory,
  extractCutChains,
  summarizeLoops,
  polygonArea,
  pointInPolygon,
} from './analysis/contours';
export type {
  AreaSummary,
  AnalyzeOptions,
  CutChain,
  EntryKind,
  TrajectoryAnalysis,
} from './analysis/contours';

export {
  toQuoteInput,
  toEpsQuoteInput,
  toPartGeometryLike,
  enrichWithArtcam,
  formatQuoteSummary,
  DEFAULT_MACHINE,
} from './integration/quote';
export type {
  MachineProfile,
  PartGeometryLike,
  PartGeometryQuality,
  QuoteGeometry,
  QuoteInput,
  QuoteMachining,
  QuoteOptions,
  TimeBreakdown,
  TimeReliability,
} from './integration/quote';
