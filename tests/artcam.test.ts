import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CompoundFile } from '../src/formats/artcam/cfb';
import { parseToolpathList, probeArtcam } from '../src/formats/artcam/probe';
import { detectFormat } from '../src/formats/detect';
import { parseGcode } from '../src/formats/gcode/parse';
import { toQuoteMetrics } from '../src/formats/gcode/metrics';

const ART = 'samples/art.art';
const CNC_A = 'samples/trayectorias.cnc';
const CNC_B = 'samples/1 (1).cnc';

function bytesOf(path: string): Uint8Array {
  const buf = readFileSync(path);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

describe('CFB / ArtCAM', () => {
  it('detecta el .art como contenedor ArtCAM', () => {
    const d = detectFormat(bytesOf(ART));
    expect(d.kind).toBe('artcam-art');
    expect(d.producer).toBe('ArtCAM');
    expect(d.confidence).toBe('alta');
  });

  it('lista los 36 streams del proyecto', () => {
    const cfb = CompoundFile.parse(bytesOf(ART));
    const streams = cfb.list().filter((e) => e.type === 'stream');
    expect(streams.length).toBe(36);
    expect(cfb.has('ArtCAM/ToolpathData/#ToolpathList')).toBe(true);
  });

  it('extrae version, material, espesor y toolpaths', () => {
    const probe = probeArtcam(bytesOf(ART));
    expect(probe.container).toBe('ole2-cfb');
    expect(probe.version).toMatch(/ArtCAM 9\.021/);
    expect(probe.materialName).toBe('Material');
    expect(probe.thicknessMm).toBeCloseTo(12, 9);
    expect(probe.toolpaths.map((t) => t.id).sort()).toEqual([
      'D6R0Rc14Q4NFAWO2alFxNASXEMS',
      'F42Ae7AsT5BlArJGfc5eQEpk9nr',
    ]);
    expect(probe.toolpaths[0]!.streams.length).toBeGreaterThanOrEqual(3);
    expect(probe.toolpaths[0]!.toolDescription).toBe('3.17mm plana');
    expect(probe.toolpaths[0]!.toolDiameterMm).toBeCloseTo(3.17, 9);
    expect(probe.toolpathGeometry).toBe('not-decoded');
    expect(probe.quotable).toBe(false);
  });

  it('parsea la lista de toolpaths con prefijo u16 de version y conteo', () => {
    const raw = bytesOf(ART);
    const cfb = CompoundFile.parse(raw);
    const list = cfb.readStream('ArtCAM/ToolpathData/#ToolpathList');
    expect(parseToolpathList(list)).toEqual(['D6R0Rc14Q4NFAWO2alFxNASXEMS', 'F42Ae7AsT5BlArJGfc5eQEpk9nr']);
  });
});

describe('G-code real: invariancia de orden', () => {
  const hasSamples = existsSync(CNC_A) && existsSync(CNC_B);
  it.skipIf(!hasSamples)('dos ordenes de las mismas operaciones dan la misma longitud de corte', () => {
    const a = toQuoteMetrics(parseGcode(new TextDecoder().decode(bytesOf(CNC_A))));
    const b = toQuoteMetrics(parseGcode(new TextDecoder().decode(bytesOf(CNC_B))));
    expect(a.engagedLengthXYMm).toBeCloseTo(b.engagedLengthXYMm, 6);
    expect(a.engagedLengthMm).toBeCloseTo(b.engagedLengthMm, 6);
    expect(a.pierceCount).toBe(b.pierceCount);
    expect(a.passCount).toBe(b.passCount);
    expect(a.bbox).toEqual(b.bbox);
    // el rapido NO es invariante: depende del orden de las operaciones
    expect(a.rapidLengthMm).not.toBeCloseTo(b.rapidLengthMm, 3);
  });

  it.skipIf(!hasSamples)('el programa real conserva geometria y declara unidades asumidas', () => {
    const p = parseGcode(new TextDecoder().decode(bytesOf(CNC_A)));
    // UNITS_ASSUMED es un supuesto documentado (confirmado contra EPS y Z);
    // no reduce coverage ni bloquea la geometria.
    expect(p.coverage).toBe(1);
    expect(p.quotable).toBe(true);
    expect(p.blockers).toEqual([]);
    expect(p.operations).toHaveLength(17);
    expect(p.warnings.some((w) => w.code === 'UNITS_ASSUMED')).toBe(true);
  });
});
