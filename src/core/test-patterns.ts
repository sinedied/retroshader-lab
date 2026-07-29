/**
 * Procedural test patterns at the resolutions emulated systems actually output, so
 * shader behaviour (scanline phase, dot matrix alignment, sharpening, moiré) can be
 * judged without needing a real screenshot. Real screenshots can be dropped in or
 * placed in `public/samples/`.
 */
import type { SourceImage } from './types.js';

export interface SystemResolution {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const SYSTEM_RESOLUTIONS: SystemResolution[] = [
  { id: 'gb', label: 'Game Boy', width: 160, height: 144 },
  { id: 'gbc', label: 'Game Boy Color', width: 160, height: 144 },
  { id: 'gba', label: 'Game Boy Advance', width: 240, height: 160 },
  { id: 'nes', label: 'NES / Famicom', width: 256, height: 240 },
  { id: 'snes', label: 'SNES / Super Famicom', width: 256, height: 224 },
  { id: 'md', label: 'Mega Drive / Genesis', width: 320, height: 224 },
  { id: 'ps1', label: 'PlayStation', width: 320, height: 240 },
  { id: 'psp', label: 'PSP', width: 480, height: 272 }
];

export type PatternKind = 'grid' | 'colorbars' | 'gradient';

export const PATTERN_KINDS: { id: PatternKind; label: string }[] = [
  { id: 'grid', label: '1px grid & checkerboard' },
  { id: 'colorbars', label: 'Color bars & ramps' },
  { id: 'gradient', label: 'Dithered gradients' }
];

function fillRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  fillRect(ctx, 0, 0, w, h, '#000000');
  // 1px checkerboard: shows any non pixel-perfect scaling instantly.
  const half = Math.floor(h / 2);
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < w; x++) {
      if ((x + y) % 2 === 0) fillRect(ctx, x, y, 1, 1, '#ffffff');
    }
  }
  // Alternating 1px horizontal then vertical lines.
  for (let y = half; y < h; y += 2) fillRect(ctx, 0, y, Math.floor(w / 2), 1, '#ffffff');
  for (let x = Math.floor(w / 2); x < w; x += 2) fillRect(ctx, x, half, 1, h - half, '#ffffff');
  // Reference border, 1px.
  ctx.strokeStyle = '#ff0000';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

function drawColorBars(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const bars = ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff', '#000000'];
  const barW = w / bars.length;
  for (const [i, color] of bars.entries()) {
    fillRect(ctx, Math.floor(i * barW), 0, Math.ceil(barW), Math.floor(h * 0.6), color);
  }
  for (let x = 0; x < w; x++) {
    const v = Math.round((x / (w - 1)) * 255);
    fillRect(ctx, x, Math.floor(h * 0.6), 1, Math.floor(h * 0.2), `rgb(${v},${v},${v})`);
  }
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    const v = Math.round((i / (steps - 1)) * 255);
    fillRect(
      ctx,
      Math.floor((i * w) / steps),
      Math.floor(h * 0.8),
      Math.ceil(w / steps),
      h,
      `rgb(${v},${v},${v})`
    );
  }
}

function drawGradient(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const bayer = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5]
  ];
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = x / (w - 1);
      const band = Math.floor((y / h) * 3);
      const threshold = bayer[y % 4][x % 4] / 16;
      const quantized = Math.floor(t * 8 + threshold) / 8;
      const value = Math.round(Math.min(1, quantized) * 255);
      const i = (y * w + x) * 4;
      image.data[i] = band === 0 || band === 2 ? value : 0;
      image.data[i + 1] = band === 1 || band === 2 ? value : 0;
      image.data[i + 2] = band === 2 ? value : band === 0 ? 0 : value;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** Renders a pattern into a canvas of the exact system resolution. */
export function createTestPattern(
  width: number,
  height: number,
  kind: PatternKind
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.imageSmoothingEnabled = false;

  switch (kind) {
    case 'colorbars':
      drawColorBars(ctx, width, height);
      break;
    case 'gradient':
      drawGradient(ctx, width, height);
      break;
    default:
      drawGrid(ctx, width, height);
      break;
  }
  return canvas;
}

export function makeGeneratedSource(system: SystemResolution, kind: PatternKind): SourceImage {
  return {
    id: `${system.id}:${kind}`,
    label: `${system.label} — ${system.width}×${system.height}`,
    width: system.width,
    height: system.height,
    bitmap: createTestPattern(system.width, system.height, kind)
  };
}

/** Loads a user-provided screenshot (drag & drop, file picker or `public/samples`). */
export async function loadImageSource(file: File | string, label?: string): Promise<SourceImage> {
  const url = typeof file === 'string' ? file : URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    const name = label ?? (typeof file === 'string' ? file.split('/').pop() : file.name) ?? 'image';
    return {
      id: `file:${name}:${image.naturalWidth}x${image.naturalHeight}`,
      label: `${name} — ${image.naturalWidth}×${image.naturalHeight}`,
      width: image.naturalWidth,
      height: image.naturalHeight,
      bitmap: image
    };
  } finally {
    if (typeof file !== 'string') setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
