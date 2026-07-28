/** Application state, persisted to localStorage and observable by the Lit components. */
import type { CfgEntry } from './cfg.js';
import type { PassConfig, PipelineConfig, ScalingMode, FilterName } from './types.js';
import type { PatternKind } from './test-patterns.js';

const STORAGE_KEY = 'retroshader-lab:state';

export type ViewMode = 'fit' | 'zoom';

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
  showSplit: boolean;
  splitPosition: number;
  showInspector: boolean;

  /** Entries preserved from an imported cfg. */
  cfgExtras: CfgEntry[];
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
    sourceSystem: 'gb',
    sourcePattern: 'scene',
    sampleFile: undefined,
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
    viewMode: 'fit',
    zoom: 1,
    showSplit: false,
    splitPosition: 0.5,
    showInspector: false,
    cfgExtras: []
  };
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
      const parsed = JSON.parse(raw) as Partial<AppState>;
      const base = defaultState();
      this.state = {
        ...base,
        ...parsed,
        pipeline: { ...base.pipeline, ...parsed.pipeline },
        // an uploaded image cannot be restored, fall back to a generated pattern
        uploadedName: undefined
      };
      this.state.pipeline.passes = (this.state.pipeline.passes ?? []).slice(0, 3);
    } catch {
      this.state = defaultState();
    }
  }
}

export const store = new Store();
