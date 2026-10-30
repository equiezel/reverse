/**
 * Deteccion del tipo real de archivo (no por extension).
 * Devuelve evidencia explicita para docs/01-triage.md.
 */

import { CompoundFile } from './artcam/cfb';

export type DetectedKind = 'gcode' | 'artcam-art' | 'postscript' | 'ole2' | 'unknown';

export interface Detection {
  kind: DetectedKind;
  confidence: 'alta' | 'media' | 'baja';
  producer: string | null;
  evidence: string[];
  text: boolean;
  notes: string[];
}

const GCODE_LINE = /^\s*(?:N\d+\s*)?(?:G\d+(?:\.\d+)?|M\d+|T\d+|S\d+|F\d+|[XYZIJK]-?\d)/i;

function ratioPrintable(bytes: Uint8Array, limit = 65536): number {
  const n = Math.min(bytes.length, limit);
  if (n === 0) return 0;
  let printable = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i]!;
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126)) printable++;
  }
  return printable / n;
}

function signature(bytes: Uint8Array): string {
  const hex = Array.from(bytes.subarray(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex;
}

export function detectFormat(bytes: Uint8Array): Detection {
  const sig = signature(bytes);
  const text = ratioPrintable(bytes) > 0.95;
  const evidence: string[] = [`firma[0..8]=${sig}`, `printable_ratio>0.95: ${text}`];

  // OLE2 / CFB
  if (sig.startsWith('d0cf11e0a1b11ae1')) {
    evidence.push('firma MS-CFB (OLE2)');
    try {
      const cfb = CompoundFile.parse(bytes);
      const paths = cfb.list().map((e) => e.path.join('/'));
      const artcam = paths.filter((p) => p.startsWith('ArtCAM/'));
      if (artcam.length > 0) {
        evidence.push(`streams ArtCAM/: ${artcam.length}`, `primer stream: ${artcam[0]}`);
        return {
          kind: 'artcam-art',
          confidence: 'alta',
          producer: 'ArtCAM',
          evidence,
          text: false,
          notes: ['Contenedor OLE2 con estructura ArtCAM/<seccion>/<objeto>'],
        };
      }
      return {
        kind: 'ole2',
        confidence: 'alta',
        producer: null,
        evidence,
        text: false,
        notes: ['OLE2 sin streams ArtCAM: no es un proyecto ArtCAM reconocible'],
      };
    } catch (err) {
      evidence.push(`fallo el parseo CFB: ${(err as Error).message}`);
      return { kind: 'ole2', confidence: 'media', producer: null, evidence, text: false, notes: [] };
    }
  }

  // PostScript / EPS
  if (bytes.length >= 4 && String.fromCharCode(...bytes.subarray(0, 4)) === '%!PS') {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
    const producer = /%%Creator:\s*(.+)/i.exec(head)?.[1]?.trim() ?? null;
    evidence.push('prefijo %!PS', producer ? `%%Creator: ${producer}` : 'sin %%Creator');
    return {
      kind: 'postscript',
      confidence: 'alta',
      producer,
      evidence,
      text: true,
      notes: ['EPS/PostScript vectorial; no es un programa de mecanizado'],
    };
  }

  // Zip (posible camuflado)
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    evidence.push('firma ZIP (PK\\x03\\x04)');
    return { kind: 'unknown', confidence: 'media', producer: null, evidence, text: false, notes: ['Contenedor ZIP: revisar contenido antes de asumir CAM'] };
  }

  if (text) {
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 200_000));
    const lines = decoded.split(/\r\n|\n|\r/);
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    const gcodeLines = nonEmpty.filter((l) => GCODE_LINE.test(l)).length;
    const ratio = nonEmpty.length === 0 ? 0 : gcodeLines / nonEmpty.length;
    const hasMotion = /\bG0?[0-3]\b/i.test(decoded) && /\b[XY]-?\d/i.test(decoded);
    evidence.push(`lineas no vacias: ${nonEmpty.length}`, `lineas tipo G-code: ${gcodeLines} (${(ratio * 100).toFixed(1)}%)`, `tiene G0-G3 y ejes: ${hasMotion}`);
    if (hasMotion && ratio > 0.5) {
      const producer = /Mach[23]?/i.test(decoded) ? 'Mach2/Mach3' : null;
      return {
        kind: 'gcode',
        confidence: ratio > 0.85 ? 'alta' : 'media',
        producer,
        evidence,
        text: true,
        notes: ['Texto plano con dialecto RS-274'],
      };
    }
    return { kind: 'unknown', confidence: 'baja', producer: null, evidence, text: true, notes: ['Texto plano sin estructura G-code'] };
  }

  return { kind: 'unknown', confidence: 'baja', producer: null, evidence, text: false, notes: ['Sin firma conocida'] };
}
