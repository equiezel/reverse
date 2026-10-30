import type { CncProgram, Vec3 } from '../../ir/types';

export interface RenderOptions {
  width?: number;
  colorBy?: 'motion' | 'operation';
  showRapids?: boolean;
  showDwells?: boolean;
  title?: string;
}

const OP_COLORS = ['#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e', '#17becf', '#8c564b', '#e377c2'];

function fmt(v: number): string {
  return (Math.round(v * 1000) / 1000).toString();
}

export function renderSvg(program: CncProgram, options: RenderOptions = {}): string {
  const showRapids = options.showRapids ?? true;
  const points: Array<{ x: number; y: number }> = [];
  for (const m of program.moves) {
    points.push(m.from, m.to);
  }
  if (points.length === 0) throw new Error('Programa sin movimientos para renderizar');

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(1e-6, maxX - minX);
  const h = Math.max(1e-6, maxY - minY);
  const pad = Math.max(w, h) * 0.03 + 1;
  const stroke = Math.max(0.05, Math.hypot(w, h) / 1500);
  const width = options.width ?? 1200;

  const opIndex = new Map<string, number>();
  program.operations.forEach((op, i) => opIndex.set(op.id, i));

  const body: string[] = [];
  body.push(`<rect x="${fmt(minX - pad)}" y="${fmt(-(maxY + pad))}" width="${fmt(w + 2 * pad)}" height="${fmt(h + 2 * pad)}" fill="#ffffff"/>`);

  for (const m of program.moves) {
    if (m.kind === 'dwell') {
      if (!options.showDwells) continue;
      body.push(`<circle cx="${fmt(m.to.x)}" cy="${fmt(-m.to.y)}" r="${fmt(stroke * 2)}" fill="none" stroke="#999"/>`);
      continue;
    }
    if (m.kind === 'rapid' && !showRapids) continue;
    const d = m.kind === 'arc'
      ? arcPath(m)
      : `M ${fmt(m.from.x)} ${fmt(-m.from.y)} L ${fmt(m.to.x)} ${fmt(-m.to.y)}`;

    let strokeColor = '#9aa0a6';
    let dash = ' stroke-dasharray="' + fmt(stroke * 4) + ' ' + fmt(stroke * 3) + '"';
    let widthFactor = 0.7;
    if (m.kind !== 'rapid') {
      dash = '';
      widthFactor = m.engagedLengthMm > 0 ? 1.2 : 0.6;
      if (options.colorBy === 'operation' && m.operationId) {
        const idx = opIndex.get(m.operationId) ?? 0;
        strokeColor = OP_COLORS[idx % OP_COLORS.length]!;
      } else {
        strokeColor = m.engagedLengthMm > 0 ? '#111111' : m.kind === 'arc' ? '#0b6bcb' : '#7fa7d8';
      }
    }
    body.push(
      `<path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${fmt(stroke * widthFactor)}"${dash} stroke-linecap="round"/>`,
    );
    if (m.pierces) {
      body.push(`<circle cx="${fmt(m.to.x)}" cy="${fmt(-m.to.y)}" r="${fmt(stroke * 1.6)}" fill="#d62728" opacity="0.8"/>`);
    }
  }

  const title = options.title ? `<title>${escapeXml(options.title)}</title>` : '';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(minX - pad)} ${fmt(-(maxY + pad))} ${fmt(w + 2 * pad)} ${fmt(h + 2 * pad)}" width="${width}" preserveAspectRatio="xMidYMid meet">`,
    title,
    body.join('\n'),
    '</svg>',
  ].join('\n');
}

function arcPath(m: CncProgram['moves'][number]): string {
  const samples = (m as CncProgram['moves'][number] & { samples?: Vec3[] }).samples;
  const pts = samples && samples.length > 1 ? samples : [m.from, m.to];
  return 'M ' + pts.map((p) => `${fmt(p.x)} ${fmt(-p.y)}`).join(' L ');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
