#!/usr/bin/env node
/**
 * CLI de investigacion.
 *
 *   npm run inspect  -- samples/trayectorias.cnc
 *   npm run dump     -- samples/art.art --offset 0 --length 256
 *   npm run dump     -- samples/art.art --stream "ArtCAM/VersionInfo/VersionA"
 *   npm run diff     -- samples/trayectorias.cnc "samples/1 (1).cnc"
 *   npm run parse    -- samples/trayectorias.cnc --json
 *   npm run render   -- samples/trayectorias.cnc --out out/trayectorias.svg
 *   npm run validate -- samples/trayectorias.cnc --dxf control.dxf
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';

import { detectFormat } from '../src/formats/detect';
import { probeArtcam } from '../src/formats/artcam/probe';
import { CompoundFile } from '../src/formats/artcam/cfb';
import { parseGcode } from '../src/formats/gcode/parse';
import { toQuoteMetrics } from '../src/formats/gcode/metrics';
import { renderSvg } from '../src/formats/gcode/render';
import { parseDxf } from '../src/formats/dxf';
import type { CncProgram } from '../src/ir/types';

interface Args {
  command: string;
  files: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const [command = 'help', ...rest] = argv;
  const files: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      files.push(a);
    }
  }
  return { command, files, flags };
}

function read(path: string): { bytes: Uint8Array; text: string } {
  const buf = readFileSync(path);
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return { bytes, text };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function entropy(bytes: Uint8Array): number {
  const counts = new Array<number>(256).fill(0);
  for (const b of bytes) counts[b]! += 1;
  let e = 0;
  for (const c of counts) {
    if (c > 0) {
      const p = c / bytes.length;
      e -= p * Math.log2(p);
    }
  }
  return e;
}

function hexdump(bytes: Uint8Array, offset: number, length: number): string {
  const end = Math.min(bytes.length, offset + length);
  const out: string[] = [];
  for (let o = offset; o < end; o += 16) {
    const chunk = bytes.subarray(o, Math.min(end, o + 16));
    const hex = Array.from(chunk)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')
      .padEnd(47);
    const asc = Array.from(chunk)
      .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.'))
      .join('');
    out.push(`${o.toString(16).padStart(8, '0')}  ${hex}  ${asc}`);
  }
  return out.join('\n');
}

function asciiStrings(bytes: Uint8Array, min = 6): string[] {
  const out: string[] = [];
  let cur = '';
  for (const b of bytes) {
    if (b >= 32 && b <= 126) {
      cur += String.fromCharCode(b);
    } else {
      if (cur.length >= min) out.push(cur);
      cur = '';
    }
  }
  if (cur.length >= min) out.push(cur);
  return out;
}

function detectAndReport(path: string, bytes: Uint8Array, text: string): number {
  const d = detectFormat(bytes);
  console.log(`archivo     : ${path}`);
  console.log(`tamano      : ${bytes.length} bytes`);
  console.log(`sha256      : ${sha256(bytes)}`);
  console.log(`tipo        : ${d.kind}   (confianza ${d.confidence})`);
  console.log(`productor   : ${d.producer ?? 'desconocido'}`);
  console.log(`texto       : ${d.text}`);
  console.log(`evidencia   : ${d.evidence.join(' | ')}`);
  if (d.notes.length) console.log(`notas       : ${d.notes.join(' | ')}`);

  if (d.kind === 'gcode') {
    const lines = text.split(/\r\n|\n|\r/);
    const words = text.match(/[A-Za-z]/g)?.length ?? 0;
    console.log(`lineas      : ${lines.length}`);
    console.log(`letras      : ${words}`);
    const codes = new Map<string, number>();
    for (const m of text.matchAll(/\b([GM])\s*(\d+(?:\.\d+)?)/g)) {
      const key = `${m[1]}${m[2]}`;
      codes.set(key, (codes.get(key) ?? 0) + 1);
    }
    const top = [...codes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.log(`codigos     : ${top.map(([k, v]) => `${k}:${v}`).join(' ')}`);
  }

  if (d.kind === 'artcam-art') {
    const probe = probeArtcam(bytes, basename(path));
    console.log(`artcam ver  : ${probe.version ?? '?'}`);
    console.log(`material    : ${probe.materialName ?? '?'}`);
    console.log(`espesor mm  : ${probe.thicknessMm ?? '?'}`);
    console.log(`toolpaths   : ${probe.toolpaths.map((t) => `${t.id}${t.toolDescription ? ` [${t.toolDescription}]` : ''}`).join(', ') || '(ninguno)'}`);
    console.log(`streams     : ${probe.streams.length}`);
    for (const s of probe.streams) console.log(`  - ${s.path} (${s.size} B)`);
    console.log(`geometria   : ${probe.toolpathGeometry}`);
    console.log(`cotizable   : no (coverage 0, toolpaths sin decodificar)`);
  }

  const strings = asciiStrings(bytes, 6);
  if (strings.length) {
    console.log(`strings(6+) : ${strings.length}  ej: ${strings.slice(0, 6).join(' | ')}`);
  }
  const block = 256;
  const hs: number[] = [];
  for (let o = 0; o < bytes.length; o += block) hs.push(entropy(bytes.subarray(o, o + block)));
  console.log(`entropia    : global=${entropy(bytes).toFixed(3)} bloques[min/mean/max]=${Math.min(...hs).toFixed(2)}/${(hs.reduce((a, b) => a + b, 0) / hs.length).toFixed(2)}/${Math.max(...hs).toFixed(2)}`);
  return 0;
}

function cmdInspect(files: string[]): number {
  if (!files.length) throw new Error('inspect requiere al menos un archivo');
  for (const f of files) {
    const { bytes, text } = read(f);
    detectAndReport(f, bytes, text);
    console.log('');
  }
  return 0;
}

function cmdDump(files: string[], flags: Args['flags']): number {
  const file = files[0];
  if (!file) throw new Error('dump requiere un archivo');
  const { bytes } = read(file);
  const offset = Number(flags.offset ?? 0);
  const length = Number(flags.length ?? 256);

  if (typeof flags.stream === 'string') {
    const cfb = CompoundFile.parse(bytes);
    const data = cfb.readStream(flags.stream);
    console.log(`stream=${flags.stream} size=${data.length}`);
    console.log(hexdump(data, offset, length));
    return 0;
  }
  console.log(hexdump(bytes, offset, length));
  return 0;
}

function cmdDiff(files: string[]): number {
  if (files.length < 2) throw new Error('diff requiere dos archivos');
  const a = read(files[0]!);
  const b = read(files[1]!);
  const da = detectFormat(a.bytes);
  const db = detectFormat(b.bytes);
  console.log(`A: ${files[0]}  ${a.bytes.length} B  ${da.kind}`);
  console.log(`B: ${files[1]}  ${b.bytes.length} B  ${db.kind}`);

  if (da.text && db.text) {
    const la = a.text.split(/\r\n|\n|\r/);
    const lb = b.text.split(/\r\n|\n|\r/);
    const n = Math.max(la.length, lb.length);
    let diffLines = 0;
    const samples: string[] = [];
    for (let i = 0; i < n; i++) {
      if (la[i] !== lb[i]) {
        diffLines++;
        if (samples.length < 12) samples.push(`  linea ${i + 1}: A="${(la[i] ?? '').trim()}" B="${(lb[i] ?? '').trim()}"`);
      }
    }
    console.log(`lineas A=${la.length} B=${lb.length} distintas=${diffLines}`);
    console.log(samples.join('\n'));
    return 0;
  }

  const n = Math.min(a.bytes.length, b.bytes.length);
  let diffs = 0;
  const offsets: number[] = [];
  for (let i = 0; i < n; i++) {
    if (a.bytes[i] !== b.bytes[i]) {
      diffs++;
      if (offsets.length < 24) offsets.push(i);
    }
  }
  console.log(`bytes iguales=${n - diffs}/${n}  distintos=${diffs}  delta_tamano=${b.bytes.length - a.bytes.length}`);
  console.log(`primeros offsets distintos: ${offsets.map((o) => `0x${o.toString(16)}`).join(' ')}`);
  return 0;
}

function loadProgram(file: string): { program: CncProgram; metrics: ReturnType<typeof toQuoteMetrics> } {
  const { bytes, text } = read(file);
  const d = detectFormat(bytes);
  if (d.kind !== 'gcode') {
    throw new Error(`parse solo soporta G-code por ahora (detectado: ${d.kind}). Para .art usar "inspect".`);
  }
  const program = parseGcode(text, { filename: basename(file) });
  return { program, metrics: toQuoteMetrics(program) };
}

function printProgram(program: CncProgram, metrics: ReturnType<typeof toQuoteMetrics>): void {
  console.log(`programa    : ${program.source.filename}`);
  console.log(`unidades    : ${program.units}`);
  console.log(`movimientos : ${program.moves.length}`);
  console.log(`operaciones : ${program.operations.length}`);
  console.log(`coverage    : ${(program.coverage * 100).toFixed(2)}%   cotizable: ${program.quotable ? 'si' : 'NO'}`);
  console.log('');
  console.log('OPERACIONES');
  for (const op of program.operations) {
    console.log(
      `  ${op.id.padEnd(5)} ${op.kind.padEnd(8)} lineas ${String(op.startLine).padStart(5)}-${String(op.endLine).padEnd(5)} pasadas=${op.passes} prof=${op.depthMm ?? '-'}mm corte=${op.cutLengthMm.toFixed(2)}mm engaged=${op.engagedLengthMm.toFixed(2)}mm pierces=${op.pierceCount}`,
    );
  }
  console.log('');
  console.log('METRICAS');
  console.log(`  longitud de corte   : ${metrics.cutLengthMm.toFixed(3)} mm (engaged ${metrics.engagedLengthMm.toFixed(3)} mm)`);
  console.log(`  rapido              : ${metrics.rapidLengthMm.toFixed(3)} mm`);
  console.log(`  perforaciones       : ${metrics.pierceCount}`);
  console.log(`  pasadas             : ${metrics.passCount}`);
  console.log(`  cambios herramienta : ${metrics.toolChangeCount}`);
  console.log(`  tiempo corte        : ${(metrics.estimatedCutSeconds / 60).toFixed(2)} min`);
  console.log(`  tiempo rapido       : ${(metrics.estimatedRapidSeconds / 60).toFixed(2)} min`);
  console.log(`  tiempo total        : ${(metrics.estimatedSeconds / 60).toFixed(2)} min  (completo: ${metrics.timeComplete})`);
  if (metrics.bbox) {
    console.log(`  bbox                : ${metrics.bbox.width.toFixed(2)} x ${metrics.bbox.height.toFixed(2)} mm  [${metrics.bbox.minX.toFixed(2)}, ${metrics.bbox.minY.toFixed(2)}]`);
  }
  console.log(`  Z                   : ${metrics.minZ ?? '-'} .. ${metrics.maxZ ?? '-'} mm`);
  console.log('');
  if (metrics.assumptions.length) {
    console.log('SUPUESTOS');
    for (const a of metrics.assumptions) console.log(`  - ${a}`);
  }
  if (program.warnings.length) {
    console.log('');
    console.log(`ADVERTENCIAS (${program.warnings.length})`);
    for (const w of program.warnings.slice(0, 30)) console.log(`  [${w.line ?? '-'}] ${w.code}: ${w.message}`);
  }
}

function cmdParse(files: string[], flags: Args['flags']): number {
  const file = files[0];
  if (!file) throw new Error('parse requiere un archivo');
  const { program, metrics } = loadProgram(file);
  if (flags.json) {
    const payload = { program, metrics };
    const json = JSON.stringify(payload, null, 2);
    if (typeof flags.out === 'string') {
      mkdirSync(dirname(flags.out), { recursive: true });
      writeFileSync(flags.out, json, 'utf-8');
      console.log(`[json] ${flags.out}`);
    } else {
      console.log(json);
    }
    return 0;
  }
  printProgram(program, metrics);
  return 0;
}

function cmdRender(files: string[], flags: Args['flags']): number {
  const file = files[0];
  if (!file) throw new Error('render requiere un archivo');
  const { program } = loadProgram(file);
  const out = typeof flags.out === 'string' ? flags.out : file.replace(/\.[^.]+$/, '') + '.svg';
  const svg = renderSvg(program, {
    colorBy: flags.by === 'operation' ? 'operation' : 'motion',
    title: basename(file),
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, svg, 'utf-8');
  console.log(`[svg] ${out}  (${program.moves.length} movimientos)`);
  return 0;
}

function cmdValidate(files: string[], flags: Args['flags']): number {
  const file = files[0];
  if (!file) throw new Error('validate requiere un archivo');
  const { metrics } = loadProgram(file);
  const tol = Number(flags.tol ?? 1.0);
  let ok = true;

  console.log(`validacion  : ${file}`);
  console.log(`longitud 3D : ${metrics.cutLengthMm.toFixed(3)} mm`);
  console.log(`engaged 3D  : ${metrics.engagedLengthMm.toFixed(3)} mm`);
  console.log(`engaged XY  : ${metrics.engagedLengthXYMm.toFixed(3)} mm`);
  console.log(`perforac.   : ${metrics.pierceCount}`);
  console.log(`coverage    : ${(metrics.coverage * 100).toFixed(2)}%`);

  if (typeof flags.dxf === 'string') {
    const dxf = parseDxf(readFileSync(flags.dxf, 'utf-8'));
    console.log('');
    console.log(`DXF control : ${flags.dxf}`);
    console.log(`  entidades : ${dxf.entityCount}`);
    console.log(`  longitud  : ${dxf.lengthMm.toFixed(3)} mm`);
    if (dxf.bbox) console.log(`  bbox      : ${dxf.bbox.width.toFixed(2)} x ${dxf.bbox.height.toFixed(2)} mm`);
    if (dxf.unsupported.length) console.log(`  no soport. : ${dxf.unsupported.join(', ')}`);

    const dLen = Math.abs(dxf.lengthMm - metrics.engagedLengthXYMm);
    console.log('');
    console.log(`  dif. longitud XY (engaged vs DXF): ${dLen.toFixed(3)} mm  (tolerancia ${tol})`);
    if (metrics.bbox && dxf.bbox) {
      const dW = Math.abs(metrics.bbox.width - dxf.bbox.width);
      const dH = Math.abs(metrics.bbox.height - dxf.bbox.height);
      console.log(`  dif. bbox: ${dW.toFixed(3)} x ${dH.toFixed(3)} mm`);
      if (dW > tol || dH > tol) ok = false;
    }
    if (dLen > Math.max(tol, dxf.lengthMm * 0.01)) ok = false;
  }

  if (!metrics.quotable) {
    console.log('');
    console.log('AVISO: coverage < 1 o hay operaciones desconocidas -> la cotizacion debe bloquearse.');
  }
  console.log('');
  console.log(ok ? 'RESULTADO: OK' : 'RESULTADO: FALLA');
  return ok ? 0 : 1;
}

function usage(): void {
  console.log(`Uso: npm run <comando> -- <archivo> [opciones]

  inspect  <archivo>                 tipo real, hash, entropia, productor, metadatos
  dump     <archivo> [--offset N] [--length M] [--stream <path>]
  diff     <a> <b>                   diferencias de texto o de bytes
  parse    <archivo> [--json] [--out salida.json]
  render   <archivo> [--out salida.svg] [--by operation|motion]
  validate <archivo> [--dxf control.dxf] [--tol 1.0]`);
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case 'inspect':
      return cmdInspect(args.files);
    case 'dump':
      return cmdDump(args.files, args.flags);
    case 'diff':
      return cmdDiff(args.files);
    case 'parse':
      return cmdParse(args.files, args.flags);
    case 'render':
      return cmdRender(args.files, args.flags);
    case 'validate':
      return cmdValidate(args.files, args.flags);
    default:
      usage();
      return args.command === 'help' ? 0 : 2;
  }
}

try {
  process.exitCode = main();
} catch (err) {
  console.error(`ERROR: ${(err as Error).message}`);
  process.exitCode = 2;
}
