import type { CncProgram, QuoteMetrics } from '../../ir/types';
import { DEFAULTS } from '../gcode/parse';

export interface MetricsOptions {
  rapidRateMmMin?: number;
  toolChangeSeconds?: number;
}

/**
 * Adaptador IR -> metricas comerciales. No conoce precios.
 * Todas las longitudes salen en mm y los tiempos en segundos.
 */
export function toQuoteMetrics(program: CncProgram, options: MetricsOptions = {}): QuoteMetrics {
  const rapidRate = options.rapidRateMmMin ?? DEFAULTS.rapidRateMmMin;
  const toolChangeSeconds = options.toolChangeSeconds ?? DEFAULTS.toolChangeSeconds;

  let cutLengthMm = 0;
  let engagedLengthMm = 0;
  let cutLengthXYMm = 0;
  let engagedLengthXYMm = 0;
  let rapidLengthMm = 0;
  let cutSeconds = 0;
  let rapidSeconds = 0;
  let dwellSeconds = 0;
  let pierceCount = 0;
  let timeComplete = true;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let hasCutPoint = false;

  for (const move of program.moves) {
    if (move.kind === 'dwell') {
      dwellSeconds += move.seconds ?? 0;
      continue;
    }
    minZ = Math.min(minZ, move.to.z, move.from.z);
    maxZ = Math.max(maxZ, move.to.z, move.from.z);

    if (move.kind === 'rapid') {
      rapidLengthMm += move.lengthMm;
      rapidSeconds += move.lengthMm > 0 ? (move.lengthMm / rapidRate) * 60 : (move.seconds ?? 0);
      continue;
    }

    cutLengthMm += move.lengthMm;
    engagedLengthMm += move.engagedLengthMm;
    cutLengthXYMm += move.lengthXYMm;
    engagedLengthXYMm += move.lengthMm > 0 ? move.lengthXYMm * (move.engagedLengthMm / move.lengthMm) : 0;
    if (move.pierces) pierceCount += 1;
    if (move.seconds === null) timeComplete = false;
    cutSeconds += move.seconds ?? 0;

    if (move.engagedLengthMm > 0 || move.kind === 'arc') {
      for (const p of [move.from, move.to]) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
        hasCutPoint = true;
      }
    }
  }

  const toolChanges = program.toolChangeCount;

  const bbox = hasCutPoint
    ? { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
    : null;

  const passCount = program.operations.reduce((s, op) => s + op.passes, 0);

  const assumptions: string[] = [
    `Rapido G0 estimado a ${rapidRate} mm/min (no lo declara el programa).`,
    `CutLength incluye entradas y rampas; engagedLength es solo lo que esta bajo z=0.`,
  ];
  if (program.tools.some((t) => t.diameterMm === null)) {
    assumptions.push('Diametro de herramienta desconocido: el programa G-code no lo declara.');
  }
  if (program.stock?.thickness === null || program.stock === null) {
    assumptions.push('Espesor de material desconocido (el G-code no lo declara).');
  }

  const estimatedCutSeconds = cutSeconds;
  const estimatedRapidSeconds = rapidSeconds;
  const estimatedSeconds =
    cutSeconds + rapidSeconds + dwellSeconds + toolChanges * toolChangeSeconds;

  return {
    units: 'mm',
    cutLengthMm,
    engagedLengthMm,
    cutLengthXYMm,
    engagedLengthXYMm,
    rapidLengthMm,
    entryFeedLengthMm: Math.max(0, cutLengthMm - engagedLengthMm),
    pierceCount,
    passCount,
    toolChangeCount: toolChanges,
    estimatedCutSeconds,
    estimatedRapidSeconds,
    estimatedSeconds,
    timeComplete,
    bbox,
    minZ: Number.isFinite(minZ) ? minZ : null,
    maxZ: Number.isFinite(maxZ) ? maxZ : null,
    thicknessMm: program.stock?.thickness ?? null,
    operationCount: program.operations.length,
    perOperation: program.operations.map((op) => ({
      id: op.id,
      kind: op.kind,
      cutLengthMm: op.cutLengthMm,
      engagedLengthMm: op.engagedLengthMm,
      pierceCount: op.pierceCount,
      passes: op.passes,
      depthMm: op.depthMm,
    })),
    warnings: program.warnings,
    coverage: program.coverage,
    quotable: program.quotable,
    assumptions,
  };
}
