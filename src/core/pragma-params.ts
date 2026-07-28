/**
 * Port of NextUI's `#pragma parameter` handling:
 *  - `extractPragmaParameters()` (generic_video.c) for parsing
 *  - `loadShaderSettings()` (minarch/ma_config.c) for the stepped value list
 *
 * NextUI turns every parameter into a discrete option list
 * (`steps = (int)((max - min) / step) + 1` values formatted with `%.2f`) and writes the
 * selected value into the cfg, so the lab quantizes values exactly the same way.
 */
import type { ShaderParam } from './types.js';

const PRAGMA_PREFIX = '#pragma parameter';
export const MAX_SHADER_PRAGMAS = 32;

/**
 * Matches `sscanf(start, "%127s \"%127[^\"]\" %f %f %f %f", ...) == 6`:
 * a name, a quoted label, then four floats. Lines that do not provide all six fields
 * are skipped, like in the C code.
 */
const PRAGMA_RE =
  /^(\S{1,127})\s+"([^"]{0,127})"\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/;

export function extractPragmaParameters(source: string): ShaderParam[] {
  const params: ShaderParam[] = [];

  for (const line of source.split('\n')) {
    if (params.length >= MAX_SHADER_PRAGMAS) break;
    if (!line.startsWith(PRAGMA_PREFIX)) continue;

    const match = PRAGMA_RE.exec(line.slice(PRAGMA_PREFIX.length).replace(/^ +/, ''));
    if (!match) continue;

    const [, name, label, def, min, max, step] = match;
    const parsed = {
      name,
      label,
      def: Number.parseFloat(def),
      min: Number.parseFloat(min),
      max: Number.parseFloat(max),
      step: Number.parseFloat(step)
    };
    if ([parsed.def, parsed.min, parsed.max, parsed.step].some(Number.isNaN)) continue;
    params.push(parsed);
  }

  return params;
}

/** Parameters NextUI would skip when building its menu (zero step or empty name). */
export function isConfigurable(param: ShaderParam): boolean {
  return param.step !== 0 && param.name.length > 0;
}

/** Number of discrete values NextUI generates for a parameter. */
export function stepCount(param: ShaderParam): number {
  if (param.step === 0) return 0;
  return Math.trunc((param.max - param.min) / param.step) + 1;
}

/** The list of values NextUI would offer, as numbers. */
export function stepValues(param: ShaderParam): number[] {
  const count = stepCount(param);
  const values: number[] = [];
  for (let s = 0; s < count; s++) values.push(param.min + s * param.step);
  return values;
}

/** `%.2f` formatting used both in the menu and in the cfg file. */
export function formatParamValue(value: number): string {
  return value.toFixed(2);
}

/**
 * Index selected for a value, following `loadShaderSettings()`: the first step within
 * 0.001 of the value, falling back to index 0 (the minimum) when nothing matches.
 */
export function stepIndexOf(param: ShaderParam, value: number): number {
  const count = stepCount(param);
  for (let s = 0; s < count; s++) {
    if (Math.abs(value - (param.min + s * param.step)) < 0.001) return s;
  }
  return 0;
}

/** Snaps a value onto NextUI's discrete steps. */
export function quantize(param: ShaderParam, value: number): number {
  const count = stepCount(param);
  if (count <= 0) return value;
  const index = Math.min(count - 1, Math.max(0, Math.round((value - param.min) / param.step)));
  return param.min + index * param.step;
}

/** Value NextUI starts with: the declared default, snapped to the step list. */
export function defaultValue(param: ShaderParam): number {
  const count = stepCount(param);
  if (count <= 0) return param.def;
  return param.min + stepIndexOf(param, param.def) * param.step;
}
