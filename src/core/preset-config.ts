/**
 * Turns a bundled NextUI preset into a usable `PipelineConfig`.
 *
 * The same resolution is used by the cfg panel (loading a preset into the editor) and by
 * the comparison panes, so a pane always shows exactly what loading the preset would give.
 * Comparison panes inherit the geometry of the edited pipeline — screen scaling, aspect and
 * output resolution — so only the shaders differ between panes.
 */
import { importCfg, type ImportedCfg } from './cfg.js';
import { defaultValue, isConfigurable, quantize } from './pragma-params.js';
import { loadPreset } from './shader-library.js';
import type { PipelineConfig, ShaderParam } from './types.js';

const cache = new Map<string, ImportedCfg>();

/** Fetches and parses a preset, caching the parsed result. */
export async function readPreset(path: string): Promise<ImportedCfg> {
  const cached = cache.get(path);
  if (cached) return cached;
  const imported = importCfg(await loadPreset(path));
  cache.set(path, imported);
  return imported;
}

/**
 * Fills in the shader parameters of imported passes, snapping any value found in the cfg
 * onto NextUI's discrete steps and falling back to each parameter's default.
 */
export function resolveParams(
  imported: ImportedCfg,
  paramsOf: (shader: string) => ShaderParam[]
): PipelineConfig['passes'] {
  return imported.passes.map((pass) => {
    const params: Record<string, number> = {};
    for (const param of paramsOf(pass.shader).filter(isConfigurable)) {
      const value = imported.paramValues[param.name];
      params[param.name] = value === undefined ? defaultValue(param) : quantize(param, value);
    }
    return { ...pass, params };
  });
}

/**
 * Builds the config of a comparison pane. `preset` undefined means the raw source, which is
 * simply the edited pipeline with no passes at all.
 */
export async function panePipelineConfig(
  preset: string | undefined,
  base: PipelineConfig,
  paramsOf: (shader: string) => ShaderParam[]
): Promise<PipelineConfig> {
  if (!preset) return { ...base, passes: [] };
  const imported = await readPreset(preset);
  return {
    ...base,
    passes: resolveParams(imported, paramsOf),
    // the look of the preset, but not its geometry
    scaleFilter: imported.scaleFilter ?? base.scaleFilter
  };
}

/** Short label for a pane, shown over the render. */
export function paneLabel(preset: string | undefined): string {
  if (!preset) return 'Raw';
  return (preset.split('/').pop() ?? preset).replace(/\.cfg$/, '');
}
