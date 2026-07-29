/** Application state, persisted to localStorage and observable by the Lit components. */
import type { CfgEntry } from './cfg.js';
import type { PassConfig, PipelineConfig, ScalingMode, FilterName } from './types.js';
import type { PatternKind } from './test-patterns.js';

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
      this.state.pipeline.passes = (this.state.pipeline.passes ?? []).slice(0, 3);
    } catch {
      this.state = defaultState();
    }
  }
}

export const store = new Store();
