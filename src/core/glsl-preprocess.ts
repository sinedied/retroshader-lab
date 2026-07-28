/**
 * Faithful port of NextUI's `load_shader_from_file()` (workspace/all/common/generic_video.c).
 *
 * The transformations applied to a RetroArch-style single-file GLSL shader are:
 *  1. every line starting with `#pragma parameter` is removed
 *  2. a `#version` of 110/120/130/140/150/330/400/410/420/430/440/450 is replaced by
 *     `#version 300 es`, any other `#version` is kept as-is
 *  3. when no `#version` is present, `#version 100` is prepended
 *  4. `#define VERTEX` (vertex stage) or `#define FRAGMENT` + the ES precision block
 *     (fragment stage) is inserted right after the version line
 *
 * Note that `PARAMETER_UNIFORM` is only defined for the fragment stage, so parameters
 * used in the vertex stage fall back to their compile-time defaults. This is a NextUI
 * quirk that has a visible effect on some shaders, so it is reproduced here.
 */

export type ShaderStage = 'vertex' | 'fragment';

const REPLACED_VERSIONS = [
  '#version 110',
  '#version 120',
  '#version 130',
  '#version 140',
  '#version 150',
  '#version 330',
  '#version 400',
  '#version 410',
  '#version 420',
  '#version 430',
  '#version 440',
  '#version 450'
];

const REPLACEMENT_VERSION = '#version 300 es\n';
const FALLBACK_VERSION = '#version 100\n';

const PRECISION_BLOCK =
  '#ifdef GL_ES\n' +
  // compat fix for fwidth, dFdx, dFdy
  '#ifdef GL_OES_standard_derivatives\n' +
  '#extension GL_OES_standard_derivatives : enable\n' +
  '#endif\n' +
  '#ifdef GL_FRAGMENT_PRECISION_HIGH\n' +
  'precision highp float;\n' +
  '#else\n' +
  'precision mediump float;\n' +
  '#endif\n' +
  '#endif\n' +
  '#define PARAMETER_UNIFORM\n';

/** Strips `#pragma parameter` lines, like the strtok loop in the C code. */
export function stripPragmaParameters(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.startsWith('#pragma parameter'))
    .join('\n');
}

export interface PreprocessResult {
  source: string;
  /** True when the original `#version` was rewritten to `#version 300 es`. */
  rewrittenToEs3: boolean;
}

/** Builds the final shader source handed to the GL driver for one stage. */
export function preprocessShader(rawSource: string, stage: ShaderStage): PreprocessResult {
  const cleaned = stripPragmaParameters(rawSource);
  const define = stage === 'vertex' ? '#define VERTEX\n' : '#define FRAGMENT\n';
  const precision = stage === 'fragment' ? PRECISION_BLOCK : '';

  const versionStart = cleaned.indexOf('#version');
  const versionEnd = versionStart >= 0 ? cleaned.indexOf('\n', versionStart) : -1;

  if (versionStart < 0 || versionEnd < 0) {
    return {
      source: FALLBACK_VERSION + define + precision + cleaned,
      rewrittenToEs3: false
    };
  }

  const versionLine = cleaned.slice(versionStart, versionEnd);
  const shouldReplace = REPLACED_VERSIONS.some((v) => versionLine.includes(v));
  const body = cleaned.slice(versionEnd + 1);

  if (shouldReplace) {
    return {
      source: REPLACEMENT_VERSION + define + precision + body,
      rewrittenToEs3: true
    };
  }

  const header = cleaned.slice(0, versionEnd + 1);
  return { source: header + define + precision + body, rewrittenToEs3: false };
}

/**
 * WebGL2 rejects `#extension GL_OES_standard_derivatives` in `#version 300 es` shaders
 * on some drivers (derivatives are core in ES 3.0). NextUI runs on GLES drivers that
 * only warn, so we retry without the extension line and report the deviation.
 */
export function withoutDerivativesExtension(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#extension GL_OES_standard_derivatives'))
    .join('\n');
}
