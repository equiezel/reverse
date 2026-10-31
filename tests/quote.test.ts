import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

import { parseGcode } from '../src/formats/gcode/parse';
import { parseEps } from '../src/formats/eps';
import { analyzeTrajectory, summarizeLoops, pointInPolygon, polygonArea } from '../src/analysis/contours';
import { toQuoteInput, toEpsQuoteInput, enrichWithArtcam } from '../src/integration/quote';
import type { ArtcamProbe } from '../src/formats/artcam/probe';

const RECT_GCODE = ['G21', 'G90', 'G0 X0 Y0 Z5', 'G1 Z-1 F100', 'G1 X100 F1000', 'G1 Y50', 'G1 X0', 'G1 Y0', 'G0 Z5', 'M30'].join('\n');

const RECT_EPS = [
  '%!PS-Adobe-3.0 EPSF-3.0',
  '%%BoundingBox: 0 0 283.4646 141.7323',
  '%%Creator: ArtCAM',
  '2.834646 2.834646 scale',
  '0 0 moveto',
  '100 0 lineto',
  '100 50 lineto',
  '0 50 lineto',
  '0 0 lineto',
  'stroke',
].join('\n');

const NESTED_EPS = [
  '%!PS-Adobe-3.0 EPSF-3.0',
  '2.834646 2.834646 scale',
  '0 0 moveto 100 0 lineto 100 50 lineto 0 50 lineto 0 0 lineto',
  '40 20 moveto 60 20 lineto 60 40 lineto 40 40 lineto 40 20 lineto',
  'stroke',
].join('\n');

function fakeArtcam(toolMm: number, thicknessMm: number): ArtcamProbe {
  return {
    container: 'ole2-cfb',
    application: 'ArtCAM',
    version: 'ArtCAM 9.021',
    materialName: 'Material',
    thicknessMm,
    toolpaths: [
      {
        id: '1',
        streams: [],
        toolDescription: `${toolMm}mm plana`,
        toolDiameterMm: toolMm,
      },
    ],
    streams: [],
    toolpathGeometry: 'not-decoded',
    coverage: 0,
    quotable: false,
    warnings: [],
  };
}

describe('Geometria: poligonos y anidamiento', () => {
  it('calcula area con signo y punto en poligono', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(polygonArea(square)).toBeCloseTo(100, 9);
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
  });

  it('un poligono cerrado con el primer punto repetido no hace que todo punto este "sobre el borde"', () => {
    const closed = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ];
    expect(pointInPolygon({ x: 500, y: 50 }, closed)).toBe(false);
    expect(pointInPolygon({ x: 5, y: 5 }, closed)).toBe(true);
  });

  it('clasifica agujero dentro de un contorno exterior', () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ];
    const hole = [
      { x: 40, y: 20 },
      { x: 60, y: 20 },
      { x: 60, y: 40 },
      { x: 40, y: 40 },
    ];
    const summary = summarizeLoops([outer, hole]);
    expect(summary.depths).toEqual([0, 1]);
    expect(summary.outerAreaMm2).toBeCloseTo(5000, 6);
    expect(summary.holeAreaMm2).toBeCloseTo(400, 6);
    expect(summary.netAreaMm2).toBeCloseTo(4600, 6);
  });
});

describe('Analisis de trayectoria G-code', () => {
  it('detecta un rectangulo cerrado y su perimetro', () => {
    const p = parseGcode(RECT_GCODE);
    const a = analyzeTrajectory(p);
    expect(a.chains).toHaveLength(1);
    expect(a.closedLoops).toHaveLength(1);
    expect(a.contourPerimeterMm).toBeCloseTo(300, 2);
    expect(a.netAreaMm2).toBeCloseTo(5000, 2);
    expect(a.entryTypes.plunge).toBe(1);
  });

  it('no duplica el area cuando el contorno se corta en dos pasadas', () => {
    const twoPass = [
      'G21',
      'G90',
      'G0 X0 Y0 Z5',
      'G1 Z-3 F100',
      'G1 X100 F1000',
      'G1 Y50',
      'G1 X0',
      'G1 Y0',
      'G1 Z-6 F100',
      'G1 X100 F1000',
      'G1 Y50',
      'G1 X0',
      'G1 Y0',
      'G0 Z5',
    ].join('\n');
    const a = analyzeTrajectory(parseGcode(twoPass));
    expect(a.chains).toHaveLength(1);
    expect(a.netAreaMm2).toBeCloseTo(5000, 2);
    expect(a.depthMm).toBeCloseTo(6, 6);
  });

  it('separa el rectangulo exterior de un agujero', () => {
    const withHole = [
      'G21',
      'G90',
      'G0 X0 Y0 Z5',
      'G1 Z-1 F100',
      'G1 X100 F1000',
      'G1 Y50',
      'G1 X0',
      'G1 Y0',
      'G0 Z5',
      'G0 X40 Y20',
      'G1 Z-1 F100',
      'G1 X60 F1000',
      'G1 Y40',
      'G1 X40',
      'G1 Y20',
      'G0 Z5',
    ].join('\n');
    const a = analyzeTrajectory(parseGcode(withHole));
    expect(a.closedLoops).toHaveLength(2);
    expect(a.holeCount).toBe(1);
    expect(a.netAreaMm2).toBeCloseTo(4600, 2);
  });
});

describe('Lector EPS', () => {
  it('lee un rectangulo de 100 x 50 mm con escala mm -> puntos', () => {
    const doc = parseEps(RECT_EPS);
    expect(doc.loopCount).toBe(1);
    expect(doc.paths[0]!.lengthMm).toBeCloseTo(300, 2);
    expect(doc.paths[0]!.areaMm2).toBeCloseTo(5000, 1);
    expect(doc.producer).toBe('ArtCAM');
  });

  it('detecta cierre sin `closepath` (ArtCAM repite el punto inicial)', () => {
    const doc = parseEps(RECT_EPS);
    expect(doc.openCount).toBe(0);
    expect(doc.paths[0]!.closed).toBe(true);
  });

  it('calcula area neta de un contorno con agujero', () => {
    const doc = parseEps(NESTED_EPS);
    expect(doc.loopCount).toBe(2);
    expect(doc.area?.netAreaMm2).toBeCloseTo(4600, 1);
    expect(doc.area?.depths).toEqual([0, 1]);
  });

  it('rechaza un archivo que no es PostScript', () => {
    expect(() => parseEps('G0 X0 Y0')).toThrowError(/no comienza con %!PS/);
  });
});

describe('Adaptador de presupuesto', () => {
  it('expone geometria, tiempo y supuestos del G-code', () => {
    const q = toQuoteInput(parseGcode(RECT_GCODE));
    expect(q.kind).toBe('machining-program');
    expect(q.quotable).toBe(true);
    expect(q.geometry.contourLengthMm).toBeCloseTo(300, 2);
    expect(q.geometry.netAreaMm2).toBeCloseTo(5000, 2);
    // sin diametro de herramienta no se puede compensar el centro de herramienta
    expect(q.geometry.partAreaMm2).toBeNull();
    expect(q.geometry.areaBasis).toBe('unknown');
    expect(q.time.reliability).toBe('estimated');
    expect(q.timeReliable).toBe(true);
    expect(q.time.totalSeconds).toBeGreaterThan(0);
    expect(q.assumptions.length).toBeGreaterThan(0);
  });

  it('con metadatos de ArtCAM rellena herramienta, espesor y area de pieza', () => {
    const program = enrichWithArtcam(parseGcode(RECT_GCODE), fakeArtcam(3.17, 12));
    const q = toQuoteInput(program);
    expect(q.machining.tool?.diameterMm).toBeCloseTo(3.17, 6);
    expect(q.machining.thicknessMm).toBe(12);
    // area barrida - r * perimetro = 5000 - 1.585 * 300
    expect(q.geometry.areaBasis).toBe('tool-center');
    expect(q.geometry.partAreaMm2).toBeCloseTo(5000 - 1.585 * 300, 3);
    expect(q.machining.partVolumeMm3).toBeCloseTo((5000 - 1.585 * 300) * 12, 3);
  });

  it('un EPS solo aporta geometria: tiempo no confiable y sin mecanizado', () => {
    const q = toEpsQuoteInput(parseEps(RECT_EPS), 'rect.eps');
    expect(q.kind).toBe('design-geometry');
    expect(q.quotable).toBe(true);
    expect(q.time.reliability).toBe('incomplete');
    expect(q.timeReliable).toBe(false);
    expect(q.machining.passes).toBe(0);
    expect(q.geometry.contourLengthMm).toBeCloseTo(300, 2);
    expect(q.geometry.partAreaMm2).toBeCloseTo(5000, 1);
  });
});

describe('Corpus real: G-code contra EPS', () => {
  const CNC = 'samples/trayectorias.cnc';
  const EPS = 'samples/1.eps';
  const has = existsSync(CNC) && existsSync(EPS);
  const gcodeText = has ? readFileSync(CNC, 'utf-8') : '';
  const epsText = has ? readFileSync(EPS, 'utf-8') : '';

  it.skipIf(!has)('describen el mismo diseno (perimetro, area y bbox)', () => {
    const program = enrichWithArtcam(parseGcode(gcodeText), fakeArtcam(3.17, 12));
    const g = toQuoteInput(program);
    const e = toEpsQuoteInput(parseEps(epsText), '1.eps');

    // 17 operaciones G-code <-> 17 subpaths EPS.
    expect(g.geometry.loopCount + g.analysis.openChains.length).toBe(17);
    expect(e.geometry.loopCount).toBe(17);

    // El G-code recorre el centro de herramienta: su perimetro total coincide
    // con el contorno EPS dentro del 1%.
    const totalG = g.geometry.contourLengthMm + g.geometry.openLengthMm;
    expect(totalG / e.geometry.contourLengthMm).toBeCloseTo(1, 2);

    // El area compensada por r*perimetro coincide con el area EPS dentro del 5%.
    expect(g.geometry.partAreaMm2).not.toBeNull();
    expect(g.geometry.partAreaMm2! / e.geometry.partAreaMm2!).toBeCloseTo(1, 1);

    // El bbox G-code es mayor que el EPS en ~ el diametro de herramienta (3.17 mm).
    const dw = g.geometry.bbox!.width - e.geometry.bbox!.width;
    const dh = g.geometry.bbox!.height - e.geometry.bbox!.height;
    expect(Math.abs(dw - 3.17)).toBeLessThan(0.2);
    expect(Math.abs(dh - 3.17)).toBeLessThan(0.2);
  });
});
