import { describe, expect, it } from 'vitest';

import { CncParseError, parseGcode } from '../src/formats/gcode/parse';
import { toQuoteMetrics } from '../src/formats/gcode/metrics';
import { renderSvg } from '../src/formats/gcode/render';

const TAU = Math.PI * 2;
const half = (Math.PI * 10) / 2; // arco de 90 grados, r=10

function program(body: string) {
  return parseGcode(['G21', 'G90', body].join('\n'), { filename: 'test.nc' });
}

function metricsOf(body: string) {
  return toQuoteMetrics(program(body));
}

const RECT = [
  'G0 X0 Y0 Z5',
  'G1 Z-1 F100',
  'G1 X100 F1000',
  'G1 Y50',
  'G1 X0',
  'G1 Y0',
  'G0 Z5',
].join('\n');

describe('G-code: geometria basica', () => {
  it('rectangulo 100x50 = 300 mm por pasada (XY)', () => {
    const m = metricsOf(RECT);
    expect(m.engagedLengthXYMm).toBeCloseTo(300, 9);
    expect(m.cutLengthXYMm).toBeCloseTo(300, 9);
  });

  it('rectangulo 2 pasadas = 600 mm y 2 niveles de profundidad', () => {
    const body = [
      'G0 X0 Y0 Z5',
      'G1 Z-1 F100',
      'G1 X100 F1000',
      'G1 Y50',
      'G1 X0',
      'G1 Y0',
      'G1 Z-2 F100',
      'G1 X100 F1000',
      'G1 Y50',
      'G1 X0',
      'G1 Y0',
      'G0 Z5',
    ].join('\n');
    const p = program(body);
    const m = toQuoteMetrics(p);
    expect(m.engagedLengthXYMm).toBeCloseTo(600, 9);
    expect(p.operations).toHaveLength(1);
    expect(p.operations[0]!.passes).toBe(2);
    expect(p.operations[0]!.depthMm).toBeCloseTo(2, 9);
    expect(m.pierceCount).toBe(1); // una sola entrada al material
  });

  it('circulo D40 completo con I/J = 2*pi*20', () => {
    const m = metricsOf(['G0 X20 Y0 Z5', 'G1 Z-1 F100', 'G2 X20 Y0 I-20 J0 F1000', 'G0 Z5'].join('\n'));
    expect(m.engagedLengthXYMm).toBeCloseTo(TAU * 20, 8);
  });

  it('arco de 90 grados r=10 = pi*10/2', () => {
    const m = metricsOf(['G0 X10 Y0 Z5', 'G1 Z-1 F100', 'G3 X0 Y10 I-10 J0 F1000', 'G0 Z5'].join('\n'));
    expect(m.engagedLengthXYMm).toBeCloseTo(half, 9);
  });

  it('G2 y G3 dan la misma longitud con orientacion opuesta (270 + 90 = 360)', () => {
    const cw = metricsOf(['G0 X10 Y0 Z5', 'G1 Z-1 F100', 'G2 X0 Y10 I-10 J0 F1000', 'G0 Z5'].join('\n'));
    const ccw = metricsOf(['G0 X10 Y0 Z5', 'G1 Z-1 F100', 'G3 X0 Y10 I-10 J0 F1000', 'G0 Z5'].join('\n'));
    expect(cw.engagedLengthXYMm + ccw.engagedLengthXYMm).toBeCloseTo(TAU * 10, 8);
    expect(cw.engagedLengthXYMm).toBeCloseTo(1.5 * Math.PI * 10, 8);
    expect(ccw.engagedLengthXYMm).toBeCloseTo(half, 8);
  });

  it('I/J y R describen el mismo arco menor', () => {
    const ij = metricsOf(['G0 X10 Y0 Z5', 'G1 Z-1 F100', 'G3 X0 Y10 I-10 J0 F1000', 'G0 Z5'].join('\n'));
    const r = metricsOf(['G0 X10 Y0 Z5', 'G1 Z-1 F100', 'G3 X0 Y10 R10 F1000', 'G0 Z5'].join('\n'));
    expect(r.engagedLengthXYMm).toBeCloseTo(ij.engagedLengthXYMm, 8);
  });

  it('R negativo toma el arco mayor', () => {
    const minor = metricsOf(['G0 X10 Y0 Z5', 'G1 Z-1 F100', 'G3 X0 Y10 R10 F1000', 'G0 Z5'].join('\n'));
    const major = metricsOf(['G0 X10 Y0 Z5', 'G1 Z-1 F100', 'G3 X0 Y10 R-10 F1000', 'G0 Z5'].join('\n'));
    expect(major.engagedLengthXYMm + minor.engagedLengthXYMm).toBeCloseTo(TAU * 10, 8);
    expect(major.engagedLengthXYMm).toBeCloseTo(1.5 * Math.PI * 10, 8);
  });

  it('G90 y G91 reconstruyen la misma geometria', () => {
    const abs = metricsOf(['G0 X0 Y0 Z5', 'G1 Z-1 F100', 'G1 X100 F1000', 'G1 Y50', 'G1 X0', 'G1 Y0', 'G0 Z5'].join('\n'));
    const inc = toQuoteMetrics(
      parseGcode(['G21', 'G90', 'G0 X0 Y0 Z5', 'G1 Z-1 F100', 'G91', 'G1 X100 F1000', 'G1 Y50', 'G1 X-100', 'G1 Y-50', 'G90', 'G0 Z5'].join('\n')),
    );
    expect(inc.engagedLengthXYMm).toBeCloseTo(abs.engagedLengthXYMm, 9);
  });

  it('pulgadas: 1 in = 25.4 mm', () => {
    const m = toQuoteMetrics(
      parseGcode(['G20', 'G90', 'G0 X0 Y0 Z0.2', 'G1 Z-0.04 F4', 'G1 X1 F60', 'G0 Z0.2'].join('\n')),
    );
    expect(m.cutLengthXYMm).toBeCloseTo(25.4, 9); // se normaliza a mm en el IR
    expect(m.units).toBe('mm');
  });

  it('unidades no declaradas generan warning y bloquean cotizacion', () => {
    const p = parseGcode('G0 X0 Y0 Z5\nG1 Z-1 F100\nG1 X10 F1000');
    expect(p.coverage).toBeLessThan(1);
    expect(p.quotable).toBe(false);
    expect(p.warnings.some((w) => w.code === 'UNITS_ASSUMED')).toBe(true);
  });

  it('arco con I/J incrementales se interpreta respecto del inicio', () => {
    const p = program(['G0 X0 Y0 Z5', 'G1 Z-1 F100', 'G2 X20 Y0 I10 J0 F1000', 'G0 Z5'].join('\n'));
    const arc = p.moves.find((m) => m.kind === 'arc');
    expect(arc?.arc?.center.x).toBeCloseTo(10, 9);
    expect(arc?.arc?.radius).toBeCloseTo(10, 9);
    expect(arc?.arc?.sweep).toBeCloseTo(Math.PI, 9);
  });
});

describe('G-code: modalidad y dialecto', () => {
  it('coordenadas sin G repiten el modo modal', () => {
    const p = program(['G0 X0 Y0 Z5', 'G1 Z-1 F100', 'X10 Y0', 'X10 Y10', 'G0 Z5'].join('\n'));
    const feeds = p.moves.filter((m) => m.kind === 'feed');
    expect(feeds).toHaveLength(3);
    expect(feeds[2]!.to.y).toBeCloseTo(10, 9);
  });

  it('ignora comentarios, checksum, % y numeros de bloque', () => {
    const text = [
      '%',
      'N10 G21 G90 (unidades mm)',
      'N20 G0 X0 Y0 Z5',
      'N30 G1 Z-1 F100 ; plunge',
      'N40 G1 X10 Y0 F1000*42',
      'N50 G0 Z5',
      '%',
    ].join('\n');
    const p = parseGcode(text);
    expect(p.moves.filter((m) => m.kind === 'feed')).toHaveLength(2);
    expect(p.warnings.some((w) => w.code === 'TEXT_IGNORED')).toBe(false);
  });

  it('tiempo de corte = longitud / feed', () => {
    const m = metricsOf(['G0 X0 Y0 Z5', 'G1 Z-1 F100', 'G1 X100 F1000', 'G0 Z5'].join('\n'));
    // 100 mm a 1000 mm/min = 6 s; la bajada de 6 mm a 100 mm/min = 3.6 s
    expect(m.estimatedCutSeconds).toBeCloseTo(6 + 3.6, 6);
  });

  it('cuenta los eventos M6 reales, incluidos cambios repetidos', () => {
    const p = program(
      [
        'T1 M6',
        'G0 X0 Y0 Z5',
        'G1 Z-1 F100',
        'G1 X10 F1000',
        'T2 M6',
        'G0 X20 Y0 Z5',
        'G1 Z-1 F100',
        'G1 X30 F1000',
        'T1 M6',
        'G0 Z5',
      ].join('\n'),
    );
    const m = toQuoteMetrics(p);
    expect(p.toolChangeCount).toBe(3);
    expect(m.toolChangeCount).toBe(3);
    expect(m.estimatedSeconds - m.estimatedCutSeconds - m.estimatedRapidSeconds).toBeCloseTo(30, 9);
  });

  it('cuenta una perforacion por entrada al material', () => {
    const two = metricsOf(
      [
        'G0 X0 Y0 Z5',
        'G1 Z-1 F100',
        'G1 X50 F1000',
        'G0 Z5',
        'G0 X100 Y0',
        'G1 Z-1 F100',
        'G1 X150 F1000',
        'G0 Z5',
      ].join('\n'),
    );
    expect(two.pierceCount).toBe(2);
    expect(two.operationCount).toBe(2);
  });

  it('G81 taladra y cuenta un agujero por posicion', () => {
    const p = program(['G0 X10 Y10 Z5', 'G81 Z-5 R1 F100', 'X20 Y10', 'X30 Y10', 'G80', 'G0 Z5'].join('\n'));
    const m = toQuoteMetrics(p);
    expect(m.pierceCount).toBe(3);
    expect(p.operations).toHaveLength(1);
    expect(p.operations[0]!.kind).toBe('drill');
    expect(p.operations[0]!.depthMm).toBeCloseTo(5, 9);
  });

  it('G41 baja coverage y bloquea la cotizacion', () => {
    const p = program(['G0 X0 Y0 Z5', 'G41 D1', 'G1 Z-1 F100', 'G1 X10 F1000', 'G0 Z5'].join('\n'));
    expect(p.coverage).toBeLessThan(1);
    expect(p.quotable).toBe(false);
    expect(p.warnings.some((w) => w.code === 'CUTTER_COMP_ACTIVE')).toBe(true);
  });

  it('bloquea cotizacion cuando G53 usa coordenadas de maquina no mapeadas', () => {
    const p = program(['G53 G0 X100 Y50 Z5', 'G1 Z-1 F100', 'G1 X110 F1000'].join('\n'));
    expect(p.coverage).toBeLessThan(1);
    expect(p.quotable).toBe(false);
    expect(p.warnings.some((w) => w.code === 'MACHINE_COORDS')).toBe(true);
  });

  it('bloquea cotizacion con offsets de longitud desconocidos', () => {
    const p = program(['G43 H1', 'G0 X0 Y0 Z5', 'G1 Z-1 F100', 'G1 X10 F1000'].join('\n'));
    expect(p.coverage).toBeLessThan(1);
    expect(p.quotable).toBe(false);
    expect(p.warnings.some((w) => w.code === 'TOOL_LENGTH_OFFSET')).toBe(true);
  });

  it('G92 no genera un movimiento falso y bloquea cotizacion', () => {
    const p = program(['G0 X0 Y0 Z5', 'G92 X100 Y50', 'G1 Z-1 F100', 'G1 X110 F1000'].join('\n'));
    expect(p.moves.some((m) => m.to.x === 100 && m.to.y === 50)).toBe(false);
    expect(p.coverage).toBeLessThan(1);
    expect(p.quotable).toBe(false);
    expect(p.warnings.some((w) => w.code === 'COORD_SET')).toBe(true);
  });

  it('un codigo G desconocido baja coverage', () => {
    const p = program(['G0 X0 Y0 Z5', 'G123', 'G1 Z-1 F100', 'G1 X10 F1000', 'G0 Z5'].join('\n'));
    expect(p.coverage).toBeLessThan(1);
    expect(p.warnings.some((w) => w.code === 'G_UNSUPPORTED')).toBe(true);
  });

  it('un bloque desconocido bloquea cotizacion aunque coverage redondee a 1', () => {
    const text = [
      'G21',
      ...Array.from({ length: 2000 }, () => 'G90'),
      'G123',
      'G0 X0 Y0 Z5',
      'G1 Z-1 F100',
      'G1 X10 F1000',
    ].join('\n');
    const p = parseGcode(text);
    expect(p.coverage).toBe(0.9995);
    expect(p.quotable).toBe(false);
  });

  it('archivo sin movimientos lanza error explicito', () => {
    expect(() => parseGcode('%\nM02\n%')).toThrow(CncParseError);
  });

  it('R imposible lanza error explicito', () => {
    expect(() => program(['G0 X0 Y0 Z5', 'G1 Z-1 F100', 'G2 X10 Y0 R1 F1000'].join('\n'))).toThrow(CncParseError);
  });
});

describe('render', () => {
  it('produce SVG valido con la extension correcta', () => {
    const svg = renderSvg(program(RECT), { width: 400 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
    expect(svg).toContain('<path');
  });
});
