/**
 * Lector minimo de Compound File Binary (MS-CFB / OLE2), solo lectura.
 *
 * Implementa lo necesario para inspeccionar .art de ArtCAM en el navegador:
 *  - header, DIFAT, FAT, miniFAT y mini stream
 *  - arbol de directorios
 *  - lectura de streams por path
 *
 * No ejecuta nada del archivo. Todos los accesos estan acotados por limites.
 * Referencia: [MS-CFB] v2019.
 */

export const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const END_OF_CHAIN = 0xfffffffe;
const FREE_SECT = 0xffffffff;
const FAT_SECT = 0xfffffffd;
const DIFAT_SECT = 0xfffffffc;
const MAX_CHAIN = 1_000_000;

export class CfbError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'CfbError';
    this.code = code;
  }
}

export interface CfbEntry {
  name: string;
  path: string[];
  type: 'storage' | 'stream' | 'root';
  size: number;
  startSector: number;
}

function u16(dv: DataView, off: number): number {
  return dv.getUint16(off, true);
}
function u32(dv: DataView, off: number): number {
  return dv.getUint32(off, true);
}
function u64(dv: DataView, off: number): number {
  const lo = dv.getUint32(off, true);
  const hi = dv.getUint32(off + 4, true);
  return hi * 0x100000000 + lo;
}

export class CompoundFile {
  readonly bytes: Uint8Array;
  readonly sectorSize: number;
  readonly miniSectorSize: number;
  readonly miniCutoff: number;
  private readonly fat: number[];
  private readonly miniFat: number[];
  private readonly entries: CfbEntry[];
  private readonly miniStream: Uint8Array;

  private constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < 512) throw new CfbError('CFB_TOO_SMALL', 'Archivo menor al header CFB');
    for (let i = 0; i < 8; i++) {
      if (bytes[i] !== CFB_SIGNATURE[i]) throw new CfbError('CFB_BAD_SIGNATURE', 'Firma CFB invalida');
    }
    const sectorShift = u16(dv, 0x1e);
    const miniShift = u16(dv, 0x20);
    if (sectorShift !== 9 && sectorShift !== 12) throw new CfbError('CFB_SECTOR_SIZE', `sector shift no soportado: ${sectorShift}`);
    if (miniShift !== 6) throw new CfbError('CFB_MINI_SIZE', `mini sector shift no soportado: ${miniShift}`);
    this.sectorSize = 1 << sectorShift;
    this.miniSectorSize = 1 << miniShift;
    this.miniCutoff = u32(dv, 0x38) || 4096;

    const numFatSectors = u32(dv, 0x2c);
    const firstDirSector = u32(dv, 0x30);
    const firstMiniFat = u32(dv, 0x3c);
    const numMiniFat = u32(dv, 0x40);
    const firstDifat = u32(dv, 0x44);
    const numDifat = u32(dv, 0x48);

    // DIFAT: 109 entradas en el header + cadena de sectores DIFAT
    const difat: number[] = [];
    for (let i = 0; i < 109; i++) {
      const s = u32(dv, 0x4c + i * 4);
      if (s !== FREE_SECT) difat.push(s);
    }
    let difatSector = firstDifat;
    let guard = 0;
    while (difatSector !== END_OF_CHAIN && difatSector !== FREE_SECT && guard++ < MAX_CHAIN) {
      const base = this.sectorOffset(difatSector);
      if (!this.inBounds(base, this.sectorSize)) throw new CfbError('CFB_DIFAT_OOB', 'Sector DIFAT fuera de rango');
      const perSector = this.sectorSize / 4;
      for (let i = 0; i < perSector - 1; i++) {
        const s = u32(dv, base + i * 4);
        if (s !== FREE_SECT) difat.push(s);
      }
      difatSector = u32(dv, base + (perSector - 1) * 4);
    }
    if (difat.length < numFatSectors) {
      throw new CfbError('CFB_FAT_TRUNCATED', 'DIFAT no cubre todos los sectores FAT');
    }
    const fat: number[] = [];
    for (let i = 0; i < numFatSectors; i++) {
      const base = this.sectorOffset(difat[i]!);
      if (!this.inBounds(base, this.sectorSize)) throw new CfbError('CFB_FAT_OOB', 'Sector FAT fuera de rango');
      const n = this.sectorSize / 4;
      for (let k = 0; k < n; k++) fat.push(u32(dv, base + k * 4));
    }
    this.fat = fat;

    const miniFat: number[] = [];
    for (const sec of this.chain(firstMiniFat, numMiniFat)) {
      const base = this.sectorOffset(sec);
      if (!this.inBounds(base, this.sectorSize)) break;
      const n = this.sectorSize / 4;
      for (let k = 0; k < n; k++) miniFat.push(u32(dv, base + k * 4));
    }
    this.miniFat = miniFat;

    // directorio
    const dirBytes = this.readChainBytes(firstDirSector);
    const ddv = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
    const entries: CfbEntry[] = [];
    const raw: Array<{ name: string; type: number; left: number; right: number; child: number; start: number; size: number }> = [];
    for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
      const nameLen = ddv.getUint16(off + 0x40, true);
      const type = dirBytes[off + 0x42]!;
      const left = ddv.getUint32(off + 0x44, true);
      const right = ddv.getUint32(off + 0x48, true);
      const child = ddv.getUint32(off + 0x4c, true);
      const start = ddv.getUint32(off + 0x74, true);
      const size = ddv.getUint32(off + 0x78, true) + ddv.getUint32(off + 0x7c, true) * 0x100000000;
      const name = decodeUtf16(dirBytes.subarray(off, off + 64), Math.min(64, Math.max(0, nameLen - 2)));
      raw.push({ name, type, left, right, child, start, size });
    }

    const root = raw.find((e) => e.type === 5);
    if (!root) throw new CfbError('CFB_NO_ROOT', 'Sin entrada root');
    const mini = this.readChainBytes(root.start);
    this.miniStream = mini.subarray(0, Math.min(root.size, mini.length));

    const walk = (idx: number, prefix: string[], acc: CfbEntry[], depth: number): void => {
      if (idx === 0xffffffff || idx >= raw.length || depth > 64) return;
      const e = raw[idx]!;
      if (e.type === 2) {
        acc.push({ name: e.name, path: [...prefix, e.name], type: 'stream', size: e.size, startSector: e.start });
      } else if (e.type === 1) {
        acc.push({ name: e.name, path: [...prefix, e.name], type: 'storage', size: 0, startSector: e.start });
        walk(e.child, [...prefix, e.name], acc, depth + 1);
      }
      walk(e.left, prefix, acc, depth + 1);
      walk(e.right, prefix, acc, depth + 1);
    };
    walk(root.child, [], entries, 0);
    this.entries = entries;
  }

  static parse(bytes: Uint8Array): CompoundFile {
    return new CompoundFile(bytes);
  }

  private sectorOffset(sector: number): number {
    return (sector + 1) * this.sectorSize;
  }

  private inBounds(offset: number, length: number): boolean {
    return offset >= 0 && length >= 0 && offset + length <= this.bytes.byteLength;
  }

  private chain(start: number, limit = MAX_CHAIN): number[] {
    const out: number[] = [];
    let s = start;
    while (s !== END_OF_CHAIN && s !== FREE_SECT && out.length < limit) {
      out.push(s);
      s = this.fat[s] ?? END_OF_CHAIN;
    }
    return out;
  }

  private readChainBytes(start: number): Uint8Array {
    if (start === END_OF_CHAIN || start === FREE_SECT) return new Uint8Array(0);
    const sectors = this.chain(start);
    const out = new Uint8Array(sectors.length * this.sectorSize);
    sectors.forEach((s, i) => {
      const base = this.sectorOffset(s);
      if (!this.inBounds(base, this.sectorSize)) return;
      out.set(this.bytes.subarray(base, base + this.sectorSize), i * this.sectorSize);
    });
    return out;
  }

  private readMiniChainBytes(start: number, size: number): Uint8Array {
    const out = new Uint8Array(size);
    let s = start;
    let written = 0;
    let guard = 0;
    while (s !== END_OF_CHAIN && s !== FREE_SECT && written < size && guard++ < MAX_CHAIN) {
      const base = s * this.miniSectorSize;
      if (base + this.miniSectorSize > this.miniStream.length) break;
      const n = Math.min(this.miniSectorSize, size - written);
      out.set(this.miniStream.subarray(base, base + n), written);
      written += n;
      s = this.miniFat[s] ?? END_OF_CHAIN;
    }
    return out;
  }

  list(): CfbEntry[] {
    return this.entries;
  }

  has(path: string): boolean {
    const key = path.toLowerCase();
    return this.entries.some((e) => e.type === 'stream' && e.path.join('/').toLowerCase() === key);
  }

  readStream(path: string): Uint8Array {
    const key = path.toLowerCase();
    const entry = this.entries.find((e) => e.type === 'stream' && e.path.join('/').toLowerCase() === key);
    if (!entry) throw new CfbError('CFB_STREAM_NOT_FOUND', `Stream no encontrado: ${path}`);
    const size = Math.min(entry.size, 64 * 1024 * 1024);
    if (entry.size < this.miniCutoff) {
      return this.readMiniChainBytes(entry.startSector, size);
    }
    return this.readChainBytes(entry.startSector).subarray(0, size);
  }
}

function decodeUtf16(bytes: Uint8Array, byteLen: number): string {
  let out = '';
  const n = Math.min(byteLen, bytes.length) & ~1;
  for (let i = 0; i < n; i += 2) {
    const code = bytes[i]! | (bytes[i + 1]! << 8);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

export { END_OF_CHAIN, FAT_SECT, DIFAT_SECT };
