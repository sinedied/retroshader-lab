/**
 * Port of NextUI's destination rect computation:
 *  - `selectScaler()` in minarch/ma_video.c decides `renderer.scale` and `renderer.aspect`
 *  - `setRectToAspectRatio()` in common/generic_video.c turns them into the dst rect
 *
 * | mode            | aspect          | rect                                              |
 * |-----------------|-----------------|---------------------------------------------------|
 * | Native          | 0               | src * floor-scale, centered                       |
 * | Cropped         | 0               | src * ceil-scale, centered (overscans the screen)  |
 * | Aspect          | core aspect     | height-driven fit, clamped to width, centered     |
 * | Aspect (screen) | source aspect   | same fit rule using the source aspect             |
 * | Fullscreen      | -1              | whole screen (stretch)                            |
 */
import type { Rect, ScalingMode } from './types.js';

const ceilDiv = (a: number, b: number): number => Math.floor((a + b - 1) / b);

/** Integer scale NextUI picks for the Native/Cropped modes. */
export function nativeScale(
  mode: ScalingMode,
  srcW: number,
  srcH: number,
  screenW: number,
  screenH: number
): number {
  if (mode === 'Cropped') {
    return Math.max(1, Math.min(ceilDiv(screenW, srcW), ceilDiv(screenH, srcH)));
  }
  return Math.max(1, Math.min(Math.floor(screenW / srcW), Math.floor(screenH / srcH)));
}

/** Aspect value NextUI hands to `setRectToAspectRatio()`. */
export function aspectFor(
  mode: ScalingMode,
  srcW: number,
  srcH: number,
  coreAspect: number
): number {
  switch (mode) {
    case 'Native':
    case 'Cropped':
      return 0;
    case 'Aspect (screen)':
      return srcW / srcH;
    case 'Fullscreen':
      return -1;
    default:
      return coreAspect;
  }
}

export function computeDstRect(
  mode: ScalingMode,
  srcW: number,
  srcH: number,
  screenW: number,
  screenH: number,
  coreAspect: number
): Rect {
  const aspect = aspectFor(mode, srcW, srcH, coreAspect);

  if (aspect === 0) {
    const scale = nativeScale(mode, srcW, srcH, screenW, screenH);
    const w = srcW * scale;
    const h = srcH * scale;
    return { x: Math.floor((screenW - w) / 2), y: Math.floor((screenH - h) / 2), w, h };
  }

  if (aspect > 0) {
    let h = screenH;
    let w = h * aspect;
    if (w > screenW) {
      w = screenW;
      h = w / aspect;
    }
    w = Math.floor(w);
    h = Math.floor(h);
    return { x: Math.floor((screenW - w) / 2), y: Math.floor((screenH - h) / 2), w, h };
  }

  return { x: 0, y: 0, w: screenW, h: screenH };
}

export interface Resolution {
  label: string;
  width: number;
  height: number;
}

/** Output resolutions, largest first: the lab default plus the resolutions real devices run at. */
export const OUTPUT_PRESETS: Resolution[] = [
  { label: '3840 × 2160 (4K)', width: 3840, height: 2160 },
  { label: '1920 × 1080 (HDMI)', width: 1920, height: 1080 },
  { label: '1280 × 960 (RP Nova)', width: 1280, height: 960 },
  { label: '1280 × 720 (TrimUI Smart Pro)', width: 1280, height: 720 },
  { label: '1024 × 768 (default, TrimUI Brick)', width: 1024, height: 768 },
  { label: '640 × 480 (RGxx)', width: 640, height: 480 }
];

/** Common core aspect ratios reported by libretro cores. */
export const CORE_ASPECTS: { label: string; value: number }[] = [
  { label: '4:3 (1.333)', value: 4 / 3 },
  { label: '10:9 (1.111) — GB / GBC', value: 10 / 9 },
  { label: '3:2 (1.500) — GBA', value: 3 / 2 },
  { label: '30:17 (1.765) — PSP', value: 480 / 272 },
  { label: '16:9 (1.778)', value: 16 / 9 },
  { label: '1:1 (1.000)', value: 1 }
];
