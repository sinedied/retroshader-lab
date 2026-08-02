/**
 * NextUI (minarch) `.cfg` reader/writer.
 *
 * Format, as produced by `Config_write()` in minarch/ma_config.c:
 *
 * ```
 * minarch_screen_scaling = Aspect
 * minarch_scale_filter = NEAREST
 * minarch_nrofshaders = 2
 * minarch_shader1 = pixellate.glsl
 * minarch_shader1_filter = NEAREST
 * minarch_shader1_srctype = source
 * minarch_shader1_scaletype = source
 * minarch_shader1_upscale = screen
 * ...
 * ia_target_gamma = 1.50      # shader parameters, by raw pragma name, %.2f
 * ```
 *
 * A leading `-` on a key marks the option as "locked" in NextUI; it is preserved.
 * Unknown keys (core options such as `gambatte_*`) are kept so a round-trip through
 * the lab does not destroy a hand-written cfg.
 */
import { deviceParamString } from './pragma-params.js';
import type {
  FilterName,
  PassConfig,
  PipelineConfig,
  ScaleTypeName,
  ScalingMode,
  ShaderParam,
  UpscaleName
} from './types.js';
import { FILTERS, SCALING_MODES, UPSCALES } from './types.js';

export interface CfgEntry {
  key: string;
  value: string;
  locked: boolean;
}

const SHADER_KEY_RE = /^minarch_shader([123])(_filter|_srctype|_scaletype|_upscale)?$/;
const KNOWN_KEYS = new Set([
  'minarch_nrofshaders',
  'minarch_scale_filter',
  'minarch_screen_scaling'
]);

export function parseCfg(text: string): CfgEntry[] {
  const entries: CfgEntry[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    let key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    const locked = key.startsWith('-');
    if (locked) key = key.slice(1);
    if (!key) continue;
    entries.push({ key, value, locked });
  }
  return entries;
}

export interface ImportedCfg {
  scaling?: ScalingMode;
  scaleFilter?: FilterName;
  passes: PassConfig[];
  /** Values found for shader parameters, applied per pass by name. */
  paramValues: Record<string, number>;
  /** Entries that are not part of the shader pipeline, preserved on export. */
  extras: CfgEntry[];
  warnings: string[];
}

function asFilter(value: string): FilterName | undefined {
  return FILTERS.find((f) => f === value.toUpperCase());
}

function asScaleType(value: string): ScaleTypeName | undefined {
  const lower = value.toLowerCase();
  if (lower === 'source' || lower === 'relative' || lower === 'viewport') return lower;
  return undefined;
}

function asUpscale(value: string): UpscaleName | undefined {
  return UPSCALES.find((u) => u === value.toLowerCase());
}

function asScaling(value: string): ScalingMode | undefined {
  return SCALING_MODES.find((m) => m.toLowerCase() === value.toLowerCase());
}

export function importCfg(text: string): ImportedCfg {
  const entries = parseCfg(text);
  const warnings: string[] = [];
  const extras: CfgEntry[] = [];
  const paramValues: Record<string, number> = {};
  const slots: (Partial<PassConfig> | undefined)[] = [undefined, undefined, undefined];
  let count = 0;
  let scaling: ScalingMode | undefined;
  let scaleFilter: FilterName | undefined;

  const slot = (index: number): Partial<PassConfig> => (slots[index] ??= {});

  for (const entry of entries) {
    if (entry.key === 'minarch_nrofshaders') {
      const parsed = entry.value.toLowerCase() === 'off' ? 0 : Number.parseInt(entry.value, 10);
      count = Number.isNaN(parsed) ? 0 : Math.min(3, Math.max(0, parsed));
      continue;
    }
    if (entry.key === 'minarch_scale_filter') {
      scaleFilter = asFilter(entry.value) ?? scaleFilter;
      continue;
    }
    if (entry.key === 'minarch_screen_scaling') {
      scaling = asScaling(entry.value) ?? scaling;
      continue;
    }

    const match = SHADER_KEY_RE.exec(entry.key);
    if (match) {
      const index = Number.parseInt(match[1], 10) - 1;
      const target = slot(index);
      switch (match[2]) {
        case undefined:
          target.shader = entry.value;
          break;
        case '_filter': {
          const filter = asFilter(entry.value);
          if (filter) target.filter = filter;
          else warnings.push(`${entry.key}: unknown filter "${entry.value}"`);
          break;
        }
        case '_srctype':
        case '_scaletype': {
          const type = asScaleType(entry.value);
          if (!type) {
            warnings.push(`${entry.key}: unknown value "${entry.value}"`);
          } else if (match[2] === '_srctype') {
            target.srctype = type;
          } else {
            target.scaletype = type;
          }
          break;
        }
        case '_upscale': {
          const upscale = asUpscale(entry.value);
          if (upscale) target.upscale = upscale;
          else warnings.push(`${entry.key}: unknown upscale "${entry.value}"`);
          break;
        }
        default:
          break;
      }
      continue;
    }

    const numeric = Number.parseFloat(entry.value);
    if (!entry.key.startsWith('minarch_') && !Number.isNaN(numeric) && /^[\d.+-]/.test(entry.value)) {
      // Could be a shader parameter; kept as both a candidate value and an extra entry
      // so unrelated numeric core options survive the round-trip.
      paramValues[entry.key] = numeric;
    }
    if (!KNOWN_KEYS.has(entry.key)) extras.push(entry);
  }

  const passes: PassConfig[] = [];
  for (let i = 0; i < count; i++) {
    const partial = slots[i];
    if (!partial?.shader) {
      warnings.push(`minarch_shader${i + 1} is missing, pass skipped`);
      continue;
    }
    passes.push({
      shader: partial.shader,
      filter: partial.filter ?? 'NEAREST',
      srctype: partial.srctype ?? 'source',
      scaletype: partial.scaletype ?? 'relative',
      upscale: partial.upscale ?? '1',
      params: {}
    });
  }

  return { scaling, scaleFilter, passes, paramValues, extras, warnings };
}

export interface ExportOptions {
  config: PipelineConfig;
  /** Parameter declarations per shader file, used to write values in cfg order. */
  paramsByShader: Map<string, ShaderParam[]>;
  /** Entries preserved from an imported cfg. */
  extras?: CfgEntry[];
  includeScreenScaling?: boolean;
}

export function exportCfg(options: ExportOptions): string {
  const { config, paramsByShader, extras = [], includeScreenScaling = true } = options;
  const lines: string[] = [];

  if (includeScreenScaling) lines.push(`minarch_screen_scaling = ${config.scaling}`);
  lines.push(`minarch_scale_filter = ${config.scaleFilter}`);
  lines.push('');
  lines.push(`minarch_nrofshaders = ${config.passes.length === 0 ? 'off' : config.passes.length}`);

  for (const [i, pass] of config.passes.entries()) {
    const n = i + 1;
    lines.push(`minarch_shader${n} = ${pass.shader}`);
    lines.push(`minarch_shader${n}_filter = ${pass.filter}`);
    lines.push(`minarch_shader${n}_srctype = ${pass.srctype}`);
    lines.push(`minarch_shader${n}_scaletype = ${pass.scaletype}`);
    lines.push(`minarch_shader${n}_upscale = ${pass.upscale}`);
  }

  const written = new Set<string>();
  const paramLines: string[] = [];
  for (const pass of config.passes) {
    for (const param of paramsByShader.get(pass.shader) ?? []) {
      if (written.has(param.name)) continue;
      const value = pass.params[param.name];
      if (value === undefined) continue;
      written.add(param.name);
      paramLines.push(`${param.name} = ${deviceParamString(param, value)}`);
    }
  }
  if (paramLines.length > 0) {
    lines.push('');
    lines.push(...paramLines);
  }

  const extraLines = extras
    .filter((entry) => !written.has(entry.key) && !entry.key.startsWith('minarch_shader'))
    .map((entry) => `${entry.locked ? '-' : ''}${entry.key} = ${entry.value}`);
  if (extraLines.length > 0) {
    lines.push('');
    lines.push(...extraLines);
  }

  return `${lines.join('\n')}\n`;
}
