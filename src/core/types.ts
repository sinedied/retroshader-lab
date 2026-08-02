/** Core domain types, mirroring NextUI's minarch shader options. */

/** `minarch_shaderN_filter` — texture min/mag filter of a pass. */
export type FilterName = 'NEAREST' | 'LINEAR';

/**
 * `minarch_shaderN_srctype` / `minarch_shaderN_scaletype`.
 * The engine also understands a third value (index 2 = viewport); it stays in the type
 * and in the cfg reader so an exotic file still loads, but it is not offered in the UI
 * because NextUI does not offer it either.
 */
export type ScaleTypeName = 'source' | 'relative' | 'viewport';

/** `minarch_shaderN_upscale` — `1`..`8` or `screen` (index 8, stored as scale 9). */
export type UpscaleName = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | 'screen';

/** `minarch_screen_scaling`. */
export type ScalingMode = 'Native' | 'Aspect' | 'Aspect (screen)' | 'Fullscreen' | 'Cropped';

export const FILTERS: FilterName[] = ['NEAREST', 'LINEAR'];
/** Values offered in the UI — the same two NextUI's menu exposes. */
export const SCALE_TYPES: ScaleTypeName[] = ['source', 'relative'];
export const UPSCALES: UpscaleName[] = ['1', '2', '3', '4', '5', '6', '7', '8', 'screen'];
export const SCALING_MODES: ScalingMode[] = [
  'Native',
  'Aspect',
  'Aspect (screen)',
  'Fullscreen',
  'Cropped'
];

/** A `#pragma parameter` declaration found in a shader source. */
export interface ShaderParam {
  name: string;
  label: string;
  def: number;
  min: number;
  max: number;
  step: number;
}

/** One shader pass of the pipeline (max 3, like NextUI's MAXSHADERS). */
export interface PassConfig {
  /** Shader file name, e.g. `pixellate.glsl`. */
  shader: string;
  filter: FilterName;
  srctype: ScaleTypeName;
  scaletype: ScaleTypeName;
  upscale: UpscaleName;
  /** Selected value for each `#pragma parameter`, keyed by parameter name. */
  params: Record<string, number>;
}

/** Sizes computed for a pass, matching the C code's per-pass bookkeeping. */
export interface PassSizes {
  /** `InputSize` uniform. */
  srcw: number;
  srch: number;
  /** `TextureSize` uniform. */
  texw: number;
  texh: number;
  /** `OutputSize` uniform / render target size. */
  dstw: number;
  dsth: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A source image (emulated screenshot or generated test pattern). */
export interface SourceImage {
  id: string;
  label: string;
  width: number;
  height: number;
  bitmap: ImageBitmap | HTMLCanvasElement | HTMLImageElement;
  /**
   * Whether opposite edges already match, so scrolling can wrap the image straight round.
   * Anything else (every screenshot) has to be mirrored instead, or the wrap drags a seam
   * through the frame.
   */
  tileable?: boolean;
}

export interface PipelineConfig {
  scaling: ScalingMode;
  /** `minarch_scale_filter`, used by the final `default.glsl` pass. */
  scaleFilter: FilterName;
  /** Aspect ratio used by the `Aspect` mode (NextUI uses the core-reported ratio). */
  coreAspect: number;
  passes: PassConfig[];
  frameCount: number;
}

export interface CompileIssue {
  pass: number;
  shader: string;
  stage: 'vertex' | 'fragment' | 'link';
  log: string;
  source: string;
}
