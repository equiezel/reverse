/**
 * Sonda de proyectos .art de ArtCAM (contenedor OLE2).
 *
 * Estado del soporte (ver docs/02-format-map.md):
 *  - Contenedor: COMPLETO (CFB).
 *  - Metadatos: version, material, espesor, lista de toolpaths: ALTA confianza.
 *  - Geometria de toolpath (streams Data2/RampData): NO decodificada.
 *
 * Por eso `coverage` es 0 para trayectorias y la cotizacion queda bloqueada:
 * el .art se usa para identificar el archivo y enriquecer metadatos, no para
 * cotizar hasta decodificar Data2.
 */

import type { CncWarning } from '../../ir/types';
import { CfbError, CompoundFile } from './cfb';

export interface ArtcamToolpathInfo {
  id: string;
  streams: Array<{ name: string; size: number }>;
  /** Descripcion de herramienta tal como "3.17mm plana" (evidencia: Params @0x1a1). */
  toolDescription: string | null;
  toolDiameterMm: number | null;
}

export interface ArtcamProbe {
  container: 'ole2-cfb';
  application: 'ArtCAM' | null;
  version: string | null;
  materialName: string | null;
  thicknessMm: number | null;
  toolpaths: ArtcamToolpathInfo[];
  streams: Array<{ path: string; size: number; kind: 'stream' }>;
  toolpathGeometry: 'not-decoded';
  coverage: 0;
  quotable: false;
  warnings: CncWarning[];
}

function u16(bytes: Uint8Array, off: number): number {
  return (bytes[off]! | (bytes[off + 1]! << 8)) & 0xffff;
}

function u32(bytes: Uint8Array, off: number): number {
  return (bytes[off]! | (bytes[off + 1]! << 8) | (bytes[off + 2]! << 16) | (bytes[off + 3]! << 24)) >>> 0;
}

function f64(bytes: Uint8Array, off: number): number {
  if (off + 8 > bytes.length) return Number.NaN;
  const dv = new DataView(bytes.buffer, bytes.byteOffset + off, 8);
  return dv.getFloat64(0, true);
}

function ascii(bytes: Uint8Array, off = 0, len = bytes.length): string {
  let out = '';
  for (let i = off; i < Math.min(bytes.length, off + len); i++) {
    const b = bytes[i]!;
    if (b === 0) break;
    out += String.fromCharCode(b);
  }
  return out;
}

function utf16le(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = bytes[i]! | (bytes[i + 1]! << 8);
    if (code === 0) continue;
    out += String.fromCharCode(code);
  }
  return out;
}

/** Lista de toolpaths serializada: u16 version, u16 count, [u16 lenInclNul, bytes]. */
export function parseToolpathList(bytes: Uint8Array): string[] {
  if (bytes.length < 4) return [];
  const count = u16(bytes, 2);
  const out: string[] = [];
  let off = 4;
  for (let i = 0; i < count; i++) {
    if (off + 2 > bytes.length) break;
    const len = u16(bytes, off);
    off += 2;
    if (len === 0 || off + len > bytes.length) break;
    const name = ascii(bytes, off, len);
    off += len;
    out.push(name);
  }
  return out;
}

/** Igual que parseToolpathList pero con strings UTF-16LE (len en bytes). */
export function parseUnicodeToolpathList(bytes: Uint8Array): string[] {
  if (bytes.length < 4) return [];
  const count = u16(bytes, 2);
  const out: string[] = [];
  let off = 4;
  for (let i = 0; i < count; i++) {
    if (off + 2 > bytes.length) break;
    const len = u16(bytes, off);
    off += 2;
    if (len === 0 || off + len > bytes.length) break;
    out.push(utf16le(bytes.subarray(off, off + len)));
    off += len;
  }
  return out;
}

/** Busca la descripcion de herramienta serializada como [u32 chars][UTF-16LE]. */
export function extractToolDescription(bytes: Uint8Array): string | null {
  for (let off = 0; off + 4 <= bytes.length; off++) {
    const len = u32(bytes, off);
    if (len < 3 || len > 64) continue;
    const end = off + 4 + len * 2;
    if (end > bytes.length) continue;
    let s = '';
    let ok = true;
    for (let i = 0; i < len; i++) {
      const code = bytes[off + 4 + i * 2]! | (bytes[off + 5 + i * 2]! << 8);
      if (code < 32 || code > 126) {
        ok = false;
        break;
      }
      s += String.fromCharCode(code);
    }
    if (ok && /\d+(?:[.,]\d+)?\s*mm/i.test(s)) return s;
  }
  return null;
}

function diameterFromDescription(desc: string | null): number | null {
  if (!desc) return null;
  const m = /(\d+(?:[.,]\d+)?)\s*mm/i.exec(desc);
  if (!m) return null;
  const v = Number.parseFloat(m[1]!.replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function probeArtcam(bytes: Uint8Array, filename = 'proyecto.art'): ArtcamProbe {
  const warnings: CncWarning[] = [];
  const cfb = CompoundFile.parse(bytes);
  const streams = cfb.list().filter((e) => e.type === 'stream').map((e) => ({ path: e.path.join('/'), size: e.size, kind: 'stream' as const }));

  const read = (path: string): Uint8Array | null => {
    try {
      return cfb.has(path) ? cfb.readStream(path) : null;
    } catch (err) {
      warnings.push({
        code: 'ART_STREAM_READ',
        message: `No se pudo leer ${path}: ${(err as Error).message}`,
        line: null,
        severity: 'warning',
      });
      return null;
    }
  };

  let version: string | null = null;
  const versionRaw = read('ArtCAM/VersionInfo/VersionA');
  if (versionRaw) {
    const text = utf16le(versionRaw);
    const m = /ArtCAM\s*([0-9][^\s]*)/i.exec(text);
    version = m ? `ArtCAM ${m[1]}` : null;
    if (!version) version = text.trim() || null;
  }

  const materialBytes = read('ArtCAM/Material/MaterialDescription');
  const materialName = materialBytes ? ascii(materialBytes, 4) || null : null;

  const thicknessBytes = read('ArtCAM/Material/MaterialThickness');
  let thicknessMm: number | null = null;
  if (thicknessBytes && thicknessBytes.length >= 8) {
    const v = f64(thicknessBytes, 0);
    if (Number.isFinite(v) && v !== 0) thicknessMm = Math.abs(v);
  }

  let ids: string[] = [];
  const listRaw = read('ArtCAM/ToolpathData/#ToolpathList');
  if (listRaw) ids = parseToolpathList(listRaw);
  if (ids.length === 0) {
    const unicodeRaw = read('ArtCAM/ToolpathData/#UnicodeToolpathList');
    if (unicodeRaw) ids = parseUnicodeToolpathList(unicodeRaw);
  }

  const toolpaths: ArtcamToolpathInfo[] = ids.map((id) => {
    const params = read(`ArtCAM/ToolpathData/${id}/Parameters`);
    const toolDescription = params ? extractToolDescription(params) : null;
    return {
      id,
      streams: streams
        .filter((s) => s.path.startsWith(`ArtCAM/ToolpathData/${id}/`))
        .map((s) => ({ name: s.path.slice(`ArtCAM/ToolpathData/${id}/`.length), size: s.size })),
      toolDescription,
      toolDiameterMm: diameterFromDescription(toolDescription),
    };
  });

  if (!ids.length) {
    warnings.push({
      code: 'ART_NO_TOOLPATHS',
      message: 'No se encontro lista de toolpaths en el contenedor',
      line: null,
      severity: 'warning',
    });
  }

  warnings.push({
    code: 'ART_GEOMETRY_NOT_DECODED',
    message:
      'La geometria de toolpath (streams Data2/RampData) no esta decodificada: el .art solo aporta metadatos. Exportar G-code/DXF para cotizar.',
    line: null,
    severity: 'warning',
  });

  return {
    container: 'ole2-cfb',
    application: version?.startsWith('ArtCAM') ? 'ArtCAM' : null,
    version,
    materialName,
    thicknessMm,
    toolpaths,
    streams,
    toolpathGeometry: 'not-decoded',
    coverage: 0,
    quotable: false,
    warnings,
  };
}

export { CfbError };
