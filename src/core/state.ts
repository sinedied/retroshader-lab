/** Application state, persisted to localStorage and observable by the Lit components. */
import type { CfgEntry } from './cfg.js';
import type { PassConfig, PipelineConfig, ScalingMode, FilterName } from './types.js';
import type { PatternKind } from './test-patterns.js';
import { resolvePresetPath } from './shader-library.js';
import { isUserRef } from './preset-config.js';

const STORAGE_KEY = 'retroshader-lab:state';

/** Screenshot shown on first run, when it is part of the bundled samples. */
export const PREFERRED_SAMPLE = 'snes-super-mario-world.png';

export type ViewMode = 'fit' | 'zoom';

/** How the comparison panes are laid out over the stage. */
export type CompareMode = 'off' | 'overlay' | 'side-by-side';

/** Which preset the cfg panel currently has loaded, if any. */
export interface SelectedPreset {
  kind: 'user' | 'stock';
  /** A user preset id, or a stock preset path such as `sets/GB/Sharp.cfg`. */
  id: string;
}

/** A comparison pane: a bundled preset path, or `undefined` for the raw source. */
export interface ComparePane {
  preset: string | undefined;
}

export interface AppState {
  /** Source selection: a generated pattern, a bundled sample or an uploaded file. */
  sourceSystem: string;
  sourcePattern: PatternKind;
  /** File name of the bundled sample from `public/samples`, when one is selected. */
  sampleFile: string | undefined;
  /** Set when the user uploaded an image; the file itself is not persisted. */
  uploadedName: string | undefined;

  outputWidth: number;
  outputHeight: number;

  pipeline: PipelineConfig;

  viewMode: ViewMode;
  zoom: number;
  /** Scene offset in CSS pixels, shared by every pane. */
  pan: { x: number; y: number };

  compareMode: CompareMode;
  /** Total number of panes on screen, including the edited pipeline. */
  paneCount: 2 | 3;
  /** Configuration of the comparison panes B and C. */
  panes: [ComparePane, ComparePane];
  /** Overlay divider positions, normalized: one for 2 panes, two for 3. */
  dividers: number[];
  /**
   * The comparison frame, in export pixels: the rectangle the panes divide and the size the
   * composite PNG is written at. Independent of the output resolution so a comparison can be
   * a wide strip of a tall render. `0` means "follow the output resolution".
   */
  compareWidth: number;
  compareHeight: number;
  /** Burn the pane labels into the exported comparison PNG. */
  exportLabels: boolean;

  /** Collapsed state of the foldable panels, keyed by panel id. */
  collapsed: Record<string, boolean>;
  showRail: boolean;
  showDock: boolean;
  showInspector: boolean;

  /** Entries preserved from an imported cfg. */
  cfgExtras: CfgEntry[];
  /** Preset shown as selected in the cfg panel. */
  selectedPreset: SelectedPreset | undefined;
}

export function defaultPass(shader = 'pixellate.glsl'): PassConfig {
  return {
    shader,
    filter: 'NEAREST',
    srctype: 'source',
    scaletype: 'source',
    upscale: 'screen',
    params: {}
  };
}

export function defaultState(): AppState {
  return {
    // first run starts on a real screenshot rather than a synthetic pattern
    sourceSystem: 'snes',
    sourcePattern: 'grid',
    sampleFile: PREFERRED_SAMPLE,
    uploadedName: undefined,
    outputWidth: 1024,
    outputHeight: 768,
    pipeline: {
      scaling: 'Aspect',
      scaleFilter: 'NEAREST',
      coreAspect: 4 / 3,
      passes: [defaultPass()],
      frameCount: 0
    },
    // 1:1 by default: the lab is for looking at pixels
    viewMode: 'zoom',
    zoom: 1,
    pan: { x: 0, y: 0 },
    compareMode: 'off',
    paneCount: 2,
    panes: [{ preset: undefined }, { preset: undefined }],
    dividers: [0.5],
    // 0 = follow the output resolution, so the comparison is unchanged until it is set
    compareWidth: 0,
    compareHeight: 0,
    exportLabels: true,
    collapsed: {},
    showRail: true,
    showDock: true,
    showInspector: false,
    cfgExtras: [],
    selectedPreset: undefined
  };
}

/** Fields written by versions of the lab that only had a raw split view. */
interface LegacyState {
  showSplit?: boolean;
  splitPosition?: number;
}

type Listener = (state: AppState) => void;

export class Store {
  private state: AppState = defaultState();
  private readonly listeners = new Set<Listener>();
  private saveTimer: number | undefined;
  /** Suspends persistence while a shared link is being shown; see `applyShared`. */
  private holdSave = false;

  get value(): AppState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  /**
   * Suspends persistence, and drops any save already queued.
   *
   * Must be called *before* a shared link starts importing its cfg: the import goes
   * through the ordinary update path, which would otherwise write the recipient's
   * localStorage before the hold was ever set.
   */
  holdSaving(): void {
    this.holdSave = true;
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
  }

  /**
   * Applies state from a shared link **without persisting it**.
   *
   * Opening someone else's link to look at it must not overwrite the session you already
   * had. Saving stays suspended until `resumeSaving()` is called, which the app does once
   * boot has settled — so the shared setup is only written once the recipient actually
   * changes something, at which point it has become theirs.
   */
  applyShared(patch: Partial<AppState>): void {
    this.holdSaving();
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  /** Ends the suspension started by `applyShared`; the next change persists as usual. */
  resumeSaving(): void {
    this.holdSave = false;
  }

  /** True while a shared link is being shown and nothing has been changed yet. */
  get isShowingShared(): boolean {
    return this.holdSave;
  }

  updatePipeline(patch: Partial<PipelineConfig>): void {
    this.state = { ...this.state, pipeline: { ...this.state.pipeline, ...patch } };
    this.emit();
  }

  updatePass(index: number, patch: Partial<PassConfig>): void {
    const passes = this.state.pipeline.passes.map((pass, i) =>
      i === index ? { ...pass, ...patch } : pass
    );
    this.updatePipeline({ passes });
  }

  setPassParam(index: number, name: string, value: number): void {
    const pass = this.state.pipeline.passes[index];
    if (!pass) return;
    this.updatePass(index, { params: { ...pass.params, [name]: value } });
  }

  setScaling(scaling: ScalingMode): void {
    this.updatePipeline({ scaling });
  }

  setScaleFilter(scaleFilter: FilterName): void {
    this.updatePipeline({ scaleFilter });
  }

  /** Number of dividers a layout needs: one less than the number of panes. */
  static dividersFor(paneCount: number): number[] {
    return Array.from({ length: paneCount - 1 }, (_, i) => (i + 1) / paneCount);
  }

  setCompare(patch: { compareMode?: CompareMode; paneCount?: 2 | 3 }): void {
    const paneCount = patch.paneCount ?? this.state.paneCount;
    const dividers =
      patch.paneCount && patch.paneCount !== this.state.paneCount
        ? Store.dividersFor(paneCount)
        : this.state.dividers;
    this.update({ ...patch, paneCount, dividers });
  }

  setPane(index: 0 | 1, preset: string | undefined): void {
    const panes: [ComparePane, ComparePane] = [...this.state.panes] as [ComparePane, ComparePane];
    panes[index] = { preset };
    this.update({ panes });
  }

  toggleCollapsed(id: string): void {
    this.update({
      collapsed: { ...this.state.collapsed, [id]: !this.state.collapsed[id] }
    });
  }

  reset(): void {
    this.state = defaultState();
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.holdSave) return;
    if (this.saveTimer !== undefined) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 250);
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // ignore quota errors, the lab still works without persistence
    }
  }

  restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<AppState> & LegacyState;
      const base = defaultState();
      this.state = {
        ...base,
        ...parsed,
        pipeline: { ...base.pipeline, ...parsed.pipeline },
        pan: { ...base.pan, ...parsed.pan },
        panes: (parsed.panes ?? base.panes).slice(0, 2) as [ComparePane, ComparePane],
        collapsed: { ...parsed.collapsed },
        // an uploaded image cannot be restored, fall back to a generated pattern
        uploadedName: undefined
      };

      // Sessions saved before multi-pane comparison used a single raw split.
      if (parsed.compareMode === undefined && parsed.showSplit) {
        this.state.compareMode = 'overlay';
        this.state.dividers = [parsed.splitPosition ?? 0.5];
      }
      // the "fake game scene" pattern was removed
      if ((this.state.sourcePattern as string) === 'scene') this.state.sourcePattern = 'grid';
      if (this.state.paneCount !== 2 && this.state.paneCount !== 3) this.state.paneCount = 2;
      if (this.state.dividers.length !== this.state.paneCount - 1) {
        this.state.dividers = Store.dividersFor(this.state.paneCount);
      }
      // sessions saved before the comparison frame existed have neither field
      if (!Number.isFinite(this.state.compareWidth) || this.state.compareWidth < 0) {
        this.state.compareWidth = 0;
      }
      if (!Number.isFinite(this.state.compareHeight) || this.state.compareHeight < 0) {
        this.state.compareHeight = 0;
      }
      if (typeof this.state.exportLabels !== 'boolean') this.state.exportLabels = true;
      this.state.pipeline.passes = (this.state.pipeline.passes ?? []).slice(0, 3);
      this.migratePresetPaths();
    } catch {
      this.state = defaultState();
    }
  }

  /**
   * Rewrites bundled preset paths saved before the presets were sorted into category
   * folders, so a restored session keeps pointing at the same file.
   *
   * The paths are rewritten here rather than merely tolerated at load time: leaving a stale
   * path in state means it gets written straight back to localStorage, and re-saved
   * sessions would carry it indefinitely. A path that no longer resolves to anything is
   * cleared, so the pane falls back to the raw source instead of failing every render.
   */
  private migratePresetPaths(): void {
    const selected = this.state.selectedPreset;
    if (selected?.kind === 'stock') {
      const resolved = resolvePresetPath(selected.id);
      this.state.selectedPreset = resolved ? { ...selected, id: resolved } : undefined;
    }
    this.state.panes = this.state.panes.map((pane) => {
      if (!pane.preset || isUserRef(pane.preset)) return pane;
      return { preset: resolvePresetPath(pane.preset) };
    }) as [ComparePane, ComparePane];
  }
}

export const store = new Store();
