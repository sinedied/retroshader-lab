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
import { loadPreset, resolvePresetPath } from './shader-library.js';
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

/** Whether a pane reference names one of the user's presets rather than a bundled path. */
export function isUserRef(ref: string): boolean {
  return ref.startsWith(USER_REF);
}

/** Looks up the cfg text and name of one of the user's presets. */
export type UserPresetLookup = (id: string) => { name: string; cfg: string } | undefined;

/** Fetches and parses a preset, caching the parsed result. */
export async function readPreset(path: string): Promise<ImportedCfg> {
  // keyed on the resolved path, so a pre-move path and its current one share one entry
  const key = resolvePresetPath(path) ?? path;
  const cached = cache.get(key);
  if (cached) return cached;
  const imported = importCfg(await loadPreset(key));
  cache.set(key, imported);
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

/**
 * The folder a bundled preset sits in — `nextui`, `other`, `perfect-retroshaders`, `sets` —
 * which is what the dropdowns group by. A preset directly in `presets/` has no category;
 * none ship that way, but a hand-dropped file would still be listed rather than swallowed.
 */
export function presetCategory(path: string): string {
  const slash = path.indexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/**
 * How a bundled preset reads in a dropdown: its path within its category, without the
 * extension. `sets/Retro.cfg` is `Retro` and `sets/GBA/Retro.cfg` is `GBA/Retro`, so the
 * nine presets called "Retro" stay tellable apart under one heading instead of needing
 * nine headings of their own.
 */
export function presetLabel(path: string): string {
  const category = presetCategory(path);
  const rest = category ? path.slice(category.length + 1) : path;
  return rest.replace(/\.cfg$/, '');
}

export interface PresetEntry {
  path: string;
  label: string;
}

/**
 * Bundled presets grouped by category for a `<select>`: categories alphabetical, and within
 * each one the presets sitting at its root before those in sub-folders, both alphabetical.
 *
 * Shared by the cfg panel and the comparison pane pickers. They used to group separately —
 * one by path depth, one not at all — and so disagreed about both labels and order.
 */
export function groupPresets(paths: readonly string[]): [string, PresetEntry[]][] {
  const groups = new Map<string, PresetEntry[]>();
  for (const path of paths) {
    const category = presetCategory(path);
    const entry = { path, label: presetLabel(path) };
    const list = groups.get(category);
    if (list) list.push(entry);
    else groups.set(category, [entry]);
  }

  for (const list of groups.values()) {
    list.sort((a, b) => {
      const nestedA = a.label.includes('/');
      const nestedB = b.label.includes('/');
      if (nestedA !== nestedB) return nestedA ? 1 : -1;
      return a.label.localeCompare(b.label);
    });
  }

  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}
