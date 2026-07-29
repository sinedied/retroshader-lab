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

/**
 * Marks a comparison pane as pointing at one of the user's own presets.
 *
 * The reference stays a plain string so saved sessions and already-shared links keep
 * parsing: anything without this prefix is a bundled preset path, exactly as before.
 */
const USER_REF = 'user:';

/** A pane reference, resolved into which kind of preset it names. */
export interface PaneRef {
  kind: 'stock' | 'user';
  /** A bundled preset path, or a user preset id. */
  id: string;
}

export function paneRef(kind: 'stock' | 'user', id: string): string {
  return kind === 'user' ? `${USER_REF}${id}` : id;
}

export function parsePaneRef(ref: string): PaneRef {
  return ref.startsWith(USER_REF)
    ? { kind: 'user', id: ref.slice(USER_REF.length) }
    : { kind: 'stock', id: ref };
}

/** Looks up the cfg text and name of one of the user's presets. */
export type UserPresetLookup = (id: string) => { name: string; cfg: string } | undefined;

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
 * Builds the config of a comparison pane. `ref` undefined means the raw source, which is
 * simply the edited pipeline with no passes at all.
 *
 * A user preset is cfg text held in the browser rather than a file that can be fetched, so
 * it is parsed straight from `lookup` and deliberately not put in the path cache — its text
 * changes whenever the user updates it, and a cached copy would outlive the edit. Returns
 * `undefined` when a user preset has been deleted out from under the pane, so the caller
 * can fall back rather than render something stale.
 */
export async function panePipelineConfig(
  ref: string | undefined,
  base: PipelineConfig,
  paramsOf: (shader: string) => ShaderParam[],
  lookup?: UserPresetLookup
): Promise<PipelineConfig | undefined> {
  if (!ref) return { ...base, passes: [] };

  const parsed = parsePaneRef(ref);
  let imported: ImportedCfg;
  if (parsed.kind === 'user') {
    const preset = lookup?.(parsed.id);
    if (!preset) return undefined;
    imported = importCfg(preset.cfg);
  } else {
    imported = await readPreset(parsed.id);
  }

  return {
    ...base,
    passes: resolveParams(imported, paramsOf),
    // the look of the preset, but not its geometry
    scaleFilter: imported.scaleFilter ?? base.scaleFilter
  };
}

/** Short label for a pane, shown over the render and burnt into the export. */
export function paneLabel(ref: string | undefined, lookup?: UserPresetLookup): string {
  if (!ref) return 'Raw';
  const parsed = parsePaneRef(ref);
  if (parsed.kind === 'user') return lookup?.(parsed.id)?.name ?? 'Missing preset';
  return (parsed.id.split('/').pop() ?? parsed.id).replace(/\.cfg$/, '');
}
