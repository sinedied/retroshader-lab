import { LitElement, html, css, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { panelStyles, bootStyles } from './shared-styles.js';
import './rsl-source-panel.js';
import './rsl-pipeline-panel.js';
import './rsl-viewport.js';
import './rsl-dock.js';
import './rsl-benchmark.js';
import type { RslViewport } from './rsl-viewport.js';
import type { RslBenchmark } from './rsl-benchmark.js';
import type { RslDock } from './rsl-dock.js';
import {
  ShaderPipeline,
  computePassSizes,
  type PassRenderInfo,
  type RenderResult
} from '../core/pipeline.js';
import {
  panePipelineConfig,
  paneLabel,
  isUserRef,
  presetLabel,
  type UserPresetLookup
} from '../core/preset-config.js';
import {
  runBenchmark,
  ROUND_PRESETS,
  type BenchmarkQuality,
  type BenchmarkResult,
  type BenchmarkTarget
} from '../core/benchmark.js';
import { UserPresetStore } from '../core/user-presets.js';
import {
  ShaderLibrary,
  FINAL_SHADER,
  BUNDLED_SAMPLES,
  BUNDLED_PRESETS,
  loadPreset,
  resolvePresetPath,
  readShaderFile,
  fetchShaderSource
} from '../core/shader-library.js';
import { computeDstRect } from '../core/scaling.js';
import {
  loadGbPalettes,
  findGbPalette,
  recolouredSource,
  type GbPaletteGroup
} from '../core/gb-palettes.js';
import {
  encodeShareUrl,
  decodeShare,
  readShareFragment,
  normaliseCfg,
  canShare
} from '../core/share.js';
import { exportCfg, importCfg } from '../core/cfg.js';
import { defaultValue, isConfigurable, quantize } from '../core/pragma-params.js';
import { store, defaultPass, type AppState, type ComparePane } from '../core/state.js';
import {
  SYSTEM_RESOLUTIONS,
  aspectOfSystem,
  loadImageSource,
  makeGeneratedSource,
  makeScrolledSource,
  type PatternKind
} from '../core/test-patterns.js';
import type {
  CompileIssue,
  PassConfig,
  PassSizes,
  PipelineConfig,
  ShaderParam,
  SourceImage
} from '../core/types.js';

/**
 * State the render output does not depend on.
 *
 * Pan, zoom and the comparison frame are applied to the canvas in CSS — the pipeline always
 * renders at the output resolution — so dragging to pan used to redraw every pane, at that
 * resolution, for a pixel-identical result. A 30-step pan drag cost 30 full renders.
 *
 * Listing what is *safe to skip* rather than what needs a render is deliberate: a field
 * added later is not in this set, so it renders, and the cost of forgetting one is a wasted
 * frame rather than a stale image.
 */
const VIEW_ONLY_KEYS = new Set<keyof AppState>([
  'pan',
  'zoom',
  'viewMode',
  'dividers',
  'compareWidth',
  'compareHeight',
  'exportLabels',
  'collapsed',
  'showRail',
  'showDock',
  'showInspector',
  'selectedPreset',
  'cfgExtras',
  'uploadedName'
]);

/**
 * Whether anything that reaches the shaders changed.
 *
 * `compareMode` and `paneCount` look like view state but are not: they decide how many panes
 * `paneConfigsForRender()` returns, so they have to trigger a render.
 */
function affectsRender(before: AppState, after: AppState): boolean {
  if (before === after) return false;
  for (const key of Object.keys(after) as (keyof AppState)[]) {
    if (before[key] === after[key] || VIEW_ONLY_KEYS.has(key)) continue;
    return true;
  }
  return false;
}

@customElement('rsl-app')
export class RslApp extends LitElement {
  static override styles = [
    panelStyles,
    bootStyles,
    css`
      :host {
        display: grid;
        /* three explicit rows, and every child is placed explicitly below. The share bar
           is conditional, and letting auto-placement handle that would drop main into an
           implicit row and cost it its minmax(0, 1fr) sizing — the same bug that
           collapsed the viewport twice before. Row 2 collapses to 0 when empty. */
        grid-template-rows: auto auto minmax(0, 1fr);
        height: 100%;
        min-height: 0;
      }

      header.masthead {
        grid-row: 1;
      }

      .share-bar {
        grid-row: 2;
      }

      main {
        grid-row: 3;
      }

      header.masthead {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px 12px;
        min-width: 0;
        padding: 10px 14px;
        border-bottom: 1px solid var(--line);
        background: linear-gradient(180deg, var(--panel-2), var(--void-2));
      }

      .logo {
        display: flex;
        align-items: baseline;
        gap: 9px;
        min-width: 0;
        text-decoration: none;
        border-radius: 4px;
        /* the mark sets its own colours; inherit so the link does not recolour it */
        color: inherit;
      }

      .logo:hover .mark em,
      .logo:focus-visible .mark em {
        text-shadow: 0 0 26px rgba(125, 255, 155, 0.95);
      }

      .logo:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px rgba(125, 255, 155, 0.45);
      }

      .logo .mark {
        font-family: var(--font-display);
        font-variation-settings: 'wdth' 125, 'wght' 800;
        font-size: 18px;
        letter-spacing: -0.02em;
        text-transform: uppercase;
        color: var(--ink);
      }

      .logo .mark em {
        font-style: normal;
        color: var(--phosphor);
        text-shadow: 0 0 22px rgba(125, 255, 155, 0.55);
      }

      .masthead .spacer {
        flex: 1;
      }

      .led {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-dim);
        font-family: var(--font-display);
        /* the state is carried by the dot alone when there is nothing to report, so the
           label has to be reachable some other way */
        cursor: help;
      }

      .led:empty {
        gap: 0;
      }

      .led::before {
        content: '';
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--phosphor);
        box-shadow: 0 0 10px var(--phosphor);
      }

      .led.error::before {
        background: var(--danger);
        box-shadow: 0 0 10px var(--danger);
      }

      main {
        display: grid;
        grid-template-columns: var(--rail) minmax(0, 1fr) var(--dock);
        grid-template-rows: minmax(0, 1fr);
        min-height: 0;
      }

      .share-bar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px 12px;
        padding: 7px 12px;
        border-bottom: 1px solid var(--line);
        background: rgba(125, 255, 155, 0.06);
        font-size: 11.5px;
        color: var(--ink);
      }

      .share-bar.bad {
        background: rgba(255, 180, 84, 0.08);
        color: var(--amber);
      }

      .share-bar .msg {
        font-weight: 500;
      }

      .share-bar .note {
        color: var(--ink-dim);
        font-size: 10.5px;
        flex-basis: 100%;
      }

      .share-bar.bad .note {
        color: var(--amber);
      }

      .share-url {
        flex: 1 1 260px;
        min-width: 0;
        font-family: var(--font-mono);
        font-size: 10.5px;
        padding: 3px 6px;
      }

      [hidden] {
        display: none !important;
      }

      /* Explicit placement, columns *and* rows: hiding a panel sets display:none,
         which removes it from the grid, and auto-placement would then pull the
         remaining items into the wrong tracks. */
      .rail {
        grid-column: 1;
        grid-row: 1;
        min-width: 0;
        min-height: 0;
        overflow-y: auto;
        padding: 10px;
        border-right: 1px solid var(--line);
        background: linear-gradient(180deg, var(--panel), var(--void-2));
      }

      rsl-viewport {
        grid-column: 2;
        grid-row: 1;
        min-width: 0;
      }

      rsl-dock {
        grid-column: 3;
        grid-row: 1;
        min-width: 0;
      }

      .footer-note {
        margin-top: 10px;
        color: var(--ink-faint);
        font-size: 10px;
        line-height: 1.6;
      }

      @media (max-width: 1500px) {
        :host {
          --rail: 312px;
          --dock: 340px;
        }
      }

      @media (max-width: 1150px) {
        main {
          grid-template-columns: 1fr !important;
          grid-template-rows: auto minmax(320px, 1fr) auto;
          overflow-y: auto;
        }

        .rail,
        rsl-viewport,
        rsl-dock {
          grid-column: 1;
        }

        .rail {
          grid-row: 1;
          /* cap the rail and let it scroll on its own, so the preview stays
             just below it instead of being pushed off the page */
          /* a scroll container's automatic minimum is 0, so grid would squeeze
             the rail to nothing: pin a usable floor and cap the rest */
          min-height: 240px;
          max-height: 40vh;
          overflow-y: auto;
          border-right: 0;
          border-bottom: 1px solid var(--line);
        }

        rsl-viewport {
          grid-row: 2;
        }

        rsl-dock {
          grid-row: 3;
          /* height:100% would resolve against an auto row and collapse the dock */
          height: auto;
          min-height: 300px;
          max-height: 45vh;
          border-left: 0;
          border-top: 1px solid var(--line);
        }
      }
    `
  ];

  @query('rsl-viewport') private viewport!: RslViewport;
  @query('rsl-dock') private dock!: RslDock | null;
  @query('rsl-benchmark') private benchmarkDialog!: RslBenchmark;

  @state() private appState: AppState = store.value;
  @state() private source: SourceImage | undefined = undefined;
  /**
   * The still image the source is built from, before any scrolling. Held apart from `source`
   * so a moving frame can be rebuilt from it every tick without reloading or recolouring.
   */
  private baseSource: SourceImage | undefined = undefined;
  @state() private passInfos: PassRenderInfo[] = [];
  @state() private issues: CompileIssue[] = [];
  @state() private warnings: string[] = [];
  @state() private renderMs = 0;
  @state() private ready = false;
  /** Messages from user actions (import, preset, upload); render warnings are separate
      because every render replaces them. */
  @state() private notices: string[] = [];
  /** Palette table, once fetched; only Game Boy screenshots need it. */
  @state() private paletteGroups: GbPaletteGroup[] = [];
  /** Scroll offset in source pixels, and the handle of the running animation loop. */
  private scrollX = 0;
  private scrollY = 0;
  private scrollLast = 0;
  /** Fractional 60Hz frames owed, so a faster display does not scroll faster. */
  private scrollAccum = 0;
  private scrollFrame: number | undefined;
  /**
   * Frames elapsed, for the `FrameCount` uniform. Deliberately not in the store: it changes
   * every frame and the store persists, so it would write localStorage sixty times a second.
   */
  private frameCount = 0;
  @state() private shaderNotice: { ok: boolean; text: string } | undefined = undefined;
  @state() private shareResult:
    | { ok: boolean; text: string; url?: string; notes: string[]; showUrl: boolean }
    | undefined = undefined;
  @state() private benchmarkResults: BenchmarkResult[] = [];
  @state() private benchmarkRunning = false;
  @state() private benchmarkProgress = 0;
  @state() private benchmarkQuality: BenchmarkQuality = 'standard';
  private benchmarkCancelled = false;

  private readonly library = new ShaderLibrary();
  private readonly userPresets = new UserPresetStore();
  /**
   * Presets that arrived with a shared link. They are kept for the session only and never
   * written to storage, so opening someone's comparison renders it without quietly adding
   * their presets to yours.
   */
  private readonly transientPresets = new Map<string, { name: string; cfg: string }>();
  /** One pipeline per comparison pane; index 0 is the pipeline being edited. */
  private pipelines: ShaderPipeline[] = [];
  /** Resolved config of each comparison pane, kept in sync with the pane selection. */
  private paneConfigs: (PipelineConfig | undefined)[] = [undefined, undefined];
  private renderScheduled = false;
  private unsubscribe: (() => void) | undefined;

  private get main(): ShaderPipeline | undefined {
    return this.pipelines[0];
  }

  override async connectedCallback(): Promise<void> {
    super.connectedCallback();
    store.restore();
    this.appState = store.value;
    this.unsubscribe = store.subscribe((state) => {
      const previous = this.appState;
      this.appState = state;
      // turning motion off has to put the still image back, and turning it on has to show
      // the offset frame straight away rather than at the next tick
      if (previous.scrollEnabled !== state.scrollEnabled) this.applyScroll();
      if (affectsRender(previous, state)) this.scheduleRender();
      this.syncScrollLoop();
    });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('hashchange', this.onHashChange);
    // a hidden tab cannot be watched, so the loop must not keep the GPU busy for it
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    await this.library.load();
    // after the library, so a shared link's custom shaders can be added and compiled
    const shared = await this.applySharedLink();
    this.ready = true;
    // Passes restored from localStorage (or the defaults) may predate the shader
    // metadata, so fill in every declared parameter with its NextUI default.
    this.syncPassParams();
    void this.refreshPanes();
    this.rebuildSource();
    // Boot housekeeping above writes state for reasons the user did not ask for, so
    // persistence only resumes once it has settled — otherwise merely opening a shared
    // link would overwrite the recipient's saved session.
    if (shared) requestAnimationFrame(() => store.resumeSaving());
    // A restored session (or a link) can already be set to scroll. The store subscription
    // only fires on *change*, and `ready` gates the loop, so boot has to start it itself.
    this.syncScrollLoop();
  }

  override disconnectedCallback(): void {
    this.unsubscribe?.();
    if (this.scrollFrame !== undefined) cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = undefined;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('hashchange', this.onHashChange);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    super.disconnectedCallback();
  }

  /**
   * Pasting a share link into an already-open tab only changes the fragment, which is a
   * same-document navigation: nothing reloads, so without this the link would appear to
   * do nothing at all.
   */
  private readonly onVisibilityChange = (): void => this.syncScrollLoop();

  private readonly onHashChange = (): void => {
    void this.applySharedLink().then((applied) => {
      if (applied) requestAnimationFrame(() => store.resumeSaving());
    });
  };

  /** `[` and `]` toggle the side panels, unless the user is typing. */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.composedPath()[0] as HTMLElement | undefined;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
      return;
    }
    if (event.key === '[') store.update({ showRail: !store.value.showRail });
    else if (event.key === ']') store.update({ showDock: !store.value.showDock });
  };

  private onViewportReady(event: CustomEvent<HTMLCanvasElement[]>): void {
    this.pipelines = event.detail.map((canvas) => new ShaderPipeline(canvas));
    this.scheduleRender();
  }

  /**
   * Resolves the preset panes into pipeline configs. Raw panes stay `undefined` so they
   * always follow the pipeline currently being edited instead of a stale snapshot.
   */
  /**
   * Resolves a comparison pane's preset, whether it is a bundled one or one of the user's.
   *
   * Consults the transient presets first: those arrive with a shared link and are kept for
   * the session only, so a link renders correctly without adding anything to the
   * recipient's saved presets.
   */
  private readonly lookupUserPreset: UserPresetLookup = (id) => {
    const transient = this.transientPresets.get(id);
    if (transient) return transient;
    const preset = this.userPresets.get(id);
    return preset ? { name: preset.name, cfg: preset.cfg } : undefined;
  };

  private async refreshPanes(): Promise<void> {
    const state = this.appState;
    const paramsOf = (shader: string) => this.library.paramsOf(shader);
    try {
      this.paneConfigs = await Promise.all(
        state.panes.map((pane) =>
          pane.preset
            ? panePipelineConfig(pane.preset, state.pipeline, paramsOf, this.lookupUserPreset)
            : undefined
        )
      );
    } catch (error) {
      this.notices = [`Could not load a comparison preset: ${(error as Error).message}`];
      return;
    }

    // a user preset a pane points at can be deleted; say so rather than leaving the pane
    // showing the raw source with no explanation
    const missing = state.panes
      .map((pane, index) => ({ pane, index }))
      .filter(({ pane, index }) => pane.preset && this.paneConfigs[index] === undefined);
    if (missing.length > 0) {
      this.notices = missing.map(
        ({ index }) =>
          `Pane ${String.fromCharCode(66 + index)} showed a preset that no longer exists, so it is showing the raw source.`
      );
      const panes = state.panes.map((pane, index) =>
        missing.some((entry) => entry.index === index) ? { preset: undefined } : pane
      ) as [ComparePane, ComparePane];
      store.update({ panes });
    }

    this.scheduleRender();
  }

  private get paramsByShader(): Map<string, ShaderParam[]> {
    const map = new Map<string, ShaderParam[]>();
    for (const entry of this.library.all) map.set(entry.name, entry.params);
    return map;
  }

  /** Selectable shaders: the final scale pass is not a pipeline shader. */
  private get shaderNames(): string[] {
    return this.library.names.filter((name) => name !== FINAL_SHADER);
  }

  /**
   * Labels for the comparison panes. Pane 0 is named after the preset it was loaded from,
   * so an exported comparison says which of the user's presets it is showing rather than
   * an anonymous "Current".
   */
  private get paneLabels(): string[] {
    const state = this.appState;
    const selected = state.selectedPreset;
    let current = 'Current';
    if (selected?.kind === 'user') current = this.userPresets.get(selected.id)?.name ?? 'Current';
    else if (selected?.kind === 'stock') current = paneLabel(selected.id);
    return [
      current,
      paneLabel(state.panes[0]?.preset, this.lookupUserPreset),
      paneLabel(state.panes[1]?.preset, this.lookupUserPreset)
    ];
  }

  /**
   * The loaded preset's name, reduced to something safe in a filename. Empty when the
   * pipeline is the user's own edit rather than a named preset, so the export keeps its
   * old shape instead of gaining a placeholder.
   */
  private get exportPresetSlug(): string {
    const selected = this.appState.selectedPreset;
    if (!selected) return '';
    // a stock preset takes its path within its category, not just its file name: nine of
    // the bundled presets are named "Retro" and six "Sharp", one per system folder, so the
    // name alone would have them all export to the same file. The category itself is
    // dropped — it says where the preset came from, not which one it is.
    const name =
      selected.kind === 'user'
        ? this.userPresets.get(selected.id)?.name
        : presetLabel(selected.id).replace(/\//g, '-');
    // a user preset name is free text, so anything a filesystem dislikes has to go.
    // Accents are folded rather than dropped, or "Ünïcødé" slugs to "n-c-d"; a name with
    // no Latin letters at all yields nothing and the preset is simply left out of the
    // filename, which is the same shape as having no preset loaded.
    return (name ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '');
  }

  /** Whether the selected sample is a Game Boy screenshot, the only kind that recolours. */
  private get gbSampleFile(): string | undefined {
    const file = this.appState.sampleFile;
    if (!file) return undefined;
    const meta = BUNDLED_SAMPLES.find((sample) => sample.file === file);
    return meta?.system === 'gb' ? file : undefined;
  }

  private rebuildSource(): void {
    const state = this.appState;
    if (state.sampleFile && !BUNDLED_SAMPLES.some((s) => s.file === state.sampleFile)) {
      // the default screenshot is not bundled in this build: fall back to a pattern
      store.update({ sampleFile: undefined });
      return;
    }
    if (state.sampleFile) {
      // Game Boy screenshots load from their greyscale master and are recoloured here, so
      // the palette is a live choice rather than something baked into the bundled file.
      const gb = this.gbSampleFile;
      const url = gb
        ? `${import.meta.env.BASE_URL}samples/originals/${gb}`
        : `${import.meta.env.BASE_URL}samples/${state.sampleFile}`;
      const wanted = state.sampleFile;
      void loadImageSource(url, state.sampleFile)
        .then(async (source) => {
          // the user may have moved on while the image and the palette table were loading
          if (store.value.sampleFile !== wanted) return;
          this.setBaseSource(gb ? await this.recolour(source) : source);
        })
        .catch((error: Error) => {
          this.notices = [`Could not load sample "${state.sampleFile}": ${error.message}`];
        });
      return;
    }
    const system =
      SYSTEM_RESOLUTIONS.find((s) => s.id === state.sourceSystem) ?? SYSTEM_RESOLUTIONS[0];
    this.setBaseSource(makeGeneratedSource(system, state.sourcePattern));
  }

  /**
   * Adopts a new still image and shows it, scrolled if the source is in motion.
   *
   * The offset restarts whenever the image itself changes, so switching screenshot does not
   * drop the viewer into the middle of a scroll they never asked for.
   */
  private setBaseSource(base: SourceImage): void {
    if (this.baseSource?.id !== base.id) {
      this.scrollX = 0;
      this.scrollY = 0;
      this.scrollAccum = 0;
    }
    this.baseSource = base;
    this.applyScroll();
    this.scheduleRender();
    this.syncScrollLoop();
  }

  /** Publishes the base image, scrolled to the current offset when motion is on. */
  private applyScroll(): void {
    const base = this.baseSource;
    if (!base) return;
    this.source = this.appState.scrollEnabled
      ? makeScrolledSource(base, Math.floor(this.scrollX), Math.floor(this.scrollY))
      : base;
  }

  /**
   * Applies the selected palette, falling back to the greyscale master if the table or the
   * palette cannot be found — a missing palette should look like a plain screenshot, not
   * like a broken source.
   */
  private async recolour(source: SourceImage): Promise<SourceImage> {
    const name = this.appState.gbPalette;
    try {
      const groups = await loadGbPalettes();
      this.paletteGroups = groups;
      const palette = findGbPalette(groups, name);
      if (!palette) {
        this.notices = [`Unknown Game Boy palette "${name}", showing the greyscale capture.`];
        return source;
      }
      return recolouredSource(source, source.bitmap, palette);
    } catch (error) {
      this.notices = [`Could not load the palette table: ${(error as Error).message}`];
      return source;
    }
  }

  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.renderPipeline();
    });
  }

  /**
   * Whether the scrolling pattern should be animating right now.
   *
   * Everything about this is a stop condition. The lab renders on demand and does no work at
   * all when left alone, which is what keeps it cool; this is the one thing that runs a
   * continuous loop, so it only does so while there is genuinely something to see. A hidden
   * document cannot be watched, and a benchmark drives its own render loop that this one
   * would corrupt.
   */
  private get shouldScroll(): boolean {
    const state = this.appState;
    return (
      this.ready &&
      this.baseSource !== undefined &&
      state.scrollEnabled &&
      state.scrollSpeed > 0 &&
      !this.benchmarkRunning &&
      document.visibilityState === 'visible'
    );
  }

  /** Starts or stops the scroll loop to match the current state. */
  private syncScrollLoop(): void {
    const wanted = this.shouldScroll;
    if (wanted === (this.scrollFrame !== undefined)) return;
    if (wanted) {
      this.scrollLast = performance.now();
      this.scrollAccum = 0;
      this.scrollFrame = requestAnimationFrame(this.onScrollFrame);
    } else {
      if (this.scrollFrame !== undefined) cancelAnimationFrame(this.scrollFrame);
      this.scrollFrame = undefined;
    }
  }

  /**
   * One animation step: advance the offset, rebuild the frame, and render.
   *
   * The offset is carried as a float and floored on use, so a speed below one pixel a frame
   * moves the field one whole pixel every few frames rather than blurring it — a framebuffer
   * has no sub-pixel state, and the slow crawl is where beating shows up most clearly.
   *
   * `frameCount` is held here rather than in the store: it changes every frame, and the
   * store persists, so putting it there would write localStorage sixty times a second.
   *
   * The step is measured against a 60Hz clock rather than the display's, so speed means
   * source pixels per *emulated* frame the way it does on the device. On a 120Hz panel that
   * makes every other tick a no-op, which also keeps the cost the same as at 60Hz.
   */
  private readonly onScrollFrame = (now: number): void => {
    this.scrollFrame = undefined;
    if (!this.shouldScroll) return;
    this.scrollFrame = requestAnimationFrame(this.onScrollFrame);

    const state = this.appState;
    this.scrollAccum += ((now - this.scrollLast) * 60) / 1000;
    this.scrollLast = now;
    // Cap catch-up after a stall, and drop the arrears rather than letting them queue up.
    const steps = Math.min(4, Math.floor(this.scrollAccum));
    if (steps <= 0) return;
    this.scrollAccum = Math.min(this.scrollAccum - steps, 1);

    const radians = (state.scrollAngle * Math.PI) / 180;
    this.scrollX += Math.cos(radians) * state.scrollSpeed * steps;
    this.scrollY += Math.sin(radians) * state.scrollSpeed * steps;
    this.frameCount += steps;

    this.applyScroll();
    this.renderPipeline();
  };

  /** Compiles anything the pipeline needs, then renders both canvases. */
  /** Config of every visible pane, pane 0 being the pipeline under edit. */
  private paneConfigsForRender(): PipelineConfig[] {
    const state = this.appState;
    const paneCount = state.compareMode === 'off' ? 1 : state.paneCount;
    // FrameCount advances only while something is animating; on the device it counts every
    // frame, and two bundled shaders read it (image-adjustment's grain, pixel_art_AA's iTime)
    const configs: PipelineConfig[] = [{ ...state.pipeline, frameCount: this.frameCount }];
    for (let i = 1; i < paneCount; i++) {
      const resolved = this.paneConfigs[i - 1];
      configs.push(
        resolved
          ? {
              ...resolved,
              scaling: state.pipeline.scaling,
              coreAspect: state.pipeline.coreAspect,
              frameCount: this.frameCount
            }
          : { ...state.pipeline, passes: [], frameCount: this.frameCount }
      );
    }
    return configs;
  }

  private renderPipeline(): void {
    if (!this.main || !this.source || !this.ready) return;
    const state = this.appState;
    const configs = this.paneConfigsForRender();

    const started = performance.now();
    let mainResult: RenderResult | undefined;

    for (const [index, config] of configs.entries()) {
      const pipeline = this.pipelines[index];
      if (!pipeline) continue;
      for (const name of new Set([FINAL_SHADER, ...config.passes.map((pass) => pass.shader)])) {
        const entry = this.library.get(name);
        if (entry) pipeline.compile(name, entry.source);
      }
      const result = pipeline.render({
        source: this.source,
        config,
        screenW: state.outputWidth,
        screenH: state.outputHeight,
        finalShaderName: FINAL_SHADER,
        inspect: index === 0
      });
      if (index === 0) mainResult = result;
    }

    this.renderMs = performance.now() - started;
    if (!mainResult) return;
    this.passInfos = mainResult.passes;
    this.issues = mainResult.issues;
    this.warnings = mainResult.warnings;
  }

  /** Puts every parameter of a pass back to the value its shader declares. */
  private resetPassParams(index: number): void {
    const pass = store.value.pipeline.passes[index];
    if (!pass) return;
    const params: Record<string, number> = {};
    for (const param of this.library.paramsOf(pass.shader).filter(isConfigurable)) {
      params[param.name] = defaultValue(param);
    }
    store.updatePass(index, { params });
  }

  /** Ensures a pass carries the default values of its shader's parameters. */
  private withDefaults(pass: PassConfig): PassConfig {
    const params: Record<string, number> = {};
    for (const param of this.library.paramsOf(pass.shader).filter(isConfigurable)) {
      const existing = pass.params[param.name];
      params[param.name] = existing === undefined ? defaultValue(param) : quantize(param, existing);
    }
    return { ...pass, params };
  }

  private syncPassParams(): void {
    const passes = store.value.pipeline.passes.map((pass) => this.withDefaults(pass));
    store.updatePipeline({ passes });
  }

  private get cfgText(): string {
    return exportCfg({
      config: this.appState.pipeline,
      paramsByShader: this.paramsByShader,
      extras: this.appState.cfgExtras
    });
  }

  private get passSizes(): PassSizes[] {
    if (!this.source) return [];
    const state = this.appState;
    const rect = computeDstRect(
      state.pipeline.scaling,
      this.source.width,
      this.source.height,
      state.outputWidth,
      state.outputHeight,
      state.pipeline.coreAspect
    );
    return computePassSizes(state.pipeline.passes, this.source.width, this.source.height, rect);
  }

  private onCfgImport(text: string): void {
    const imported = importCfg(text);
    const passes = imported.passes.map((pass) => {
      const params: Record<string, number> = {};
      for (const param of this.library.paramsOf(pass.shader).filter(isConfigurable)) {
        const value = imported.paramValues[param.name];
        params[param.name] =
          value === undefined ? defaultValue(param) : quantize(param, value);
      }
      return { ...pass, params };
    });

    store.update({ cfgExtras: imported.extras, selectedPreset: undefined });
    store.updatePipeline({
      passes,
      ...(imported.scaling ? { scaling: imported.scaling } : {}),
      ...(imported.scaleFilter ? { scaleFilter: imported.scaleFilter } : {})
    });
    this.notices = [...imported.warnings];
  }

  /** Loads either a bundled preset or one of the user's own, both as cfg text. */
  /** Measures each visible pane, pane 0 being the reference every percentage uses. */
  private async runPaneBenchmark(): Promise<void> {
    if (!this.source || !this.main?.canTime || this.benchmarkRunning) return;
    const state = this.appState;
    const configs = this.paneConfigsForRender();

    const targets: BenchmarkTarget[] = configs.flatMap((config, index) => {
      const pipeline = this.pipelines[index];
      if (!pipeline) return [];
      // the same labels the panes carry on screen, so the table names the user's own presets
      const label = index === 0 ? this.paneLabels[0] : this.paneLabels[index];
      // render() silently skips passes whose shader is not cached, which would time a
      // pane as almost free; compile up front rather than trusting the last frame to have
      for (const name of new Set([FINAL_SHADER, ...config.passes.map((pass) => pass.shader)])) {
        const entry = this.library.get(name);
        if (entry) pipeline.compile(name, entry.source);
      }
      return [{ label, shaders: config.passes.map((pass) => pass.shader), pipeline, config }];
    });
    if (targets.length === 0) return;

    this.benchmarkRunning = true;
    // the benchmark renders in a tight loop of its own; a scroll loop on top would both
    // corrupt the measurement and be measured by it
    this.syncScrollLoop();
    this.benchmarkCancelled = false;
    this.benchmarkProgress = 0;
    this.benchmarkResults = [];

    try {
      const results = await runBenchmark(targets, {
        source: this.source,
        screenW: state.outputWidth,
        screenH: state.outputHeight,
        finalShaderName: FINAL_SHADER,
        rounds: ROUND_PRESETS[this.benchmarkQuality],
        onProgress: (done, total) => (this.benchmarkProgress = done / total),
        shouldCancel: () => this.benchmarkCancelled
      });
      if (!this.benchmarkCancelled) this.benchmarkResults = results;
    } catch (error) {
      // a failed run must say so rather than leaving an empty dialog looking idle
      this.notices = [
        ...this.notices,
        `Benchmark failed: ${error instanceof Error ? error.message : String(error)}`
      ];
    } finally {
      this.benchmarkRunning = false;
      // the panes were re-rendered many times during the run, so restore the real frame
      this.scheduleRender();
      this.syncScrollLoop();
    }
  }

  private openBenchmark(): void {
    this.benchmarkDialog.show();
    void this.runPaneBenchmark();
  }

  /**
   * Builds a shareable URL and copies it.
   *
   * A stock preset the user has not touched travels as a bare reference, so the ordinary
   * link stays a few hundred characters; anything else embeds its cfg, and any custom
   * shader the pipeline uses is embedded with it.
   */
  private async onShare(): Promise<void> {
    const state = this.appState;
    try {
      const pristineStockCfg = await this.pristineStockCfg();
      const selected = state.selectedPreset;
      const result = await encodeShareUrl(
        {
          state,
          paramsByShader: this.paramsByShader,
          customShader: (name) => {
            const entry = this.library.get(name);
            return entry?.custom ? entry.source : undefined;
          },
          userPreset: (id) => this.lookupUserPreset(id),
          pristineStockCfg,
          userPresetName:
            selected?.kind === 'user' ? this.userPresets.get(selected.id)?.name : undefined
        },
        window.location.href
      );

      const notes: string[] = [];
      let copied = true;
      try {
        await navigator.clipboard.writeText(result.url);
      } catch {
        // clipboard needs a secure context and permission; show the URL instead of failing
        copied = false;
      }
      if (result.warning) notes.push(result.warning);
      if (state.uploadedName) {
        notes.push(
          `Your uploaded image "${state.uploadedName}" is not included — a link cannot carry it, so the recipient sees the selected sample instead.`
        );
      }

      this.shareResult = {
        ok: true,
        url: result.url,
        text: copied
          ? `Link copied — ${result.length.toLocaleString()} characters.`
          : `Could not reach the clipboard, so here is the link (${result.length.toLocaleString()} characters):`,
        notes,
        showUrl: !copied
      };
    } catch (error) {
      this.shareResult = {
        ok: false,
        text: error instanceof Error ? error.message : String(error),
        notes: [],
        showUrl: false
      };
    }
  }

  /** The selected stock preset's cfg, normalised, or undefined if it has been edited. */
  private async pristineStockCfg(): Promise<string | undefined> {
    const selected = this.appState.selectedPreset;
    if (selected?.kind !== 'stock') return undefined;
    try {
      return normaliseCfg(await loadPreset(selected.id), this.paramsByShader);
    } catch {
      return undefined;
    }
  }

  /**
   * Applies a shared link, if the fragment carries one.
   *
   * Shaders arrive before the pipeline that references them, and are matched by content:
   * a shader already here under the same name with the same source is reused, while one
   * that merely shares a name is stored under a free name and the pass references are
   * rewritten — otherwise the link would silently render with the recipient's unrelated
   * shader of that name.
   */
  private async applySharedLink(): Promise<boolean> {
    const encoded = readShareFragment(window.location.hash);
    if (!encoded) return false;

    try {
      const shared = await decodeShare(encoded);
      // before any import: onCfgImport goes through the ordinary update path, which would
      // otherwise persist over the recipient's own session
      store.holdSaving();
      // and before that import too: a link carries only what the sender changed from the
      // defaults, so it has to land on the defaults rather than on the recipient's own
      // settings. This is in-memory only — holdSaving above keeps it out of localStorage.
      store.resetForShared();
      const renames = new Map<string, string>();

      // presets a pane points at are held for the session only: rendering someone's
      // comparison must not quietly add their presets to the recipient's list
      for (const preset of shared.presets) {
        this.transientPresets.set(preset.id, { name: preset.name, cfg: preset.cfg });
      }

      for (const shader of shared.shaders) {
        const existing = this.library.get(shader.name);
        if (existing?.source === shader.source) continue;
        const entry = this.library.addFromText(shader.name, shader.source);
        if (entry.name !== shader.name) renames.set(shader.name, entry.name);
      }

      if (shared.cfg) {
        const cfg = [...renames].reduce(
          (text, [from, to]) => text.split(`= ${from}`).join(`= ${to}`),
          shared.cfg
        );
        this.onCfgImport(cfg);
      } else if (shared.stockPreset) {
        this.onCfgImport(await loadPreset(shared.stockPreset));
      }

      // scaling and core aspect ride outside the cfg, so apply them onto the pipeline
      const pipelinePatch: Partial<PipelineConfig> = {};
      if (shared.scaling) pipelinePatch.scaling = shared.scaling as PipelineConfig['scaling'];
      if (shared.coreAspect !== undefined) pipelinePatch.coreAspect = shared.coreAspect;
      if (Object.keys(pipelinePatch).length > 0) store.updatePipeline(pipelinePatch);

      const patch: Partial<AppState> = { ...shared.patch };
      // a link made before the presets moved into category folders still names the old
      // paths, and they would otherwise be written into state and shown as a missing
      // selection; the fetch above already resolves, so only the stored ids need it
      if (patch.panes) {
        patch.panes = patch.panes.map((pane) =>
          pane.preset && !isUserRef(pane.preset)
            ? { preset: resolvePresetPath(pane.preset) }
            : pane
        ) as [ComparePane, ComparePane];
      }
      if (shared.stockPreset) {
        const resolved = resolvePresetPath(shared.stockPreset);
        if (resolved) patch.selectedPreset = { kind: 'stock', id: resolved };
      }
      // the shared state is applied but not saved: see Store.applyShared
      store.applyShared(patch);
      this.appState = store.value;

      const named = shared.presetName ? ` of “${shared.presetName}”` : '';
      const remapped =
        renames.size > 0
          ? ` Custom shaders renamed to avoid clashing with yours: ${[...renames.values()].join(', ')}.`
          : '';
      this.notices = [
        `Showing a shared setup${named}. Your own session is untouched until you change something.${remapped}`
      ];
      return true;
    } catch (error) {
      this.notices = [
        `That shared link could not be opened: ${error instanceof Error ? error.message : String(error)}`
      ];
      return false;
    }
  }

  private async onPresetLoad(selection: { kind: string; id: string }): Promise<void> {
    try {
      if (selection.kind === 'user') {
        const preset = this.userPresets.get(selection.id);
        if (!preset) return;
        this.onCfgImport(preset.cfg);
      } else {
        this.onCfgImport(await loadPreset(selection.id));
      }
      store.update({
        selectedPreset: { kind: selection.kind === 'user' ? 'user' : 'stock', id: selection.id }
      });
    } catch (error) {
      this.notices = [`Could not load preset "${selection.id}": ${(error as Error).message}`];
    }
  }

  private onPresetSave(): void {
    const selected = this.appState.selectedPreset;
    const suggested =
      selected?.kind === 'user'
        ? (this.userPresets.get(selected.id)?.name ?? '')
        : selected
          ? `${(selected.id.split('/').pop() ?? '').replace(/\.cfg$/, '')} (copy)`
          : '';
    const name = window.prompt('Name this preset', suggested)?.trim();
    if (!name) return;
    if (this.userPresets.hasName(name)) {
      const existing = this.userPresets.all.find(
        (preset) => preset.name.toLowerCase() === name.toLowerCase()
      );
      if (!existing || !window.confirm(`"${name}" already exists. Overwrite it?`)) return;
      this.userPresets.update(existing.id, { cfg: this.cfgText });
      store.update({ selectedPreset: { kind: 'user', id: existing.id } });
    } else {
      const created = this.userPresets.create(name, this.cfgText);
      store.update({ selectedPreset: { kind: 'user', id: created.id } });
    }
    this.requestUpdate();
  }

  private onPresetRename(id: string): void {
    const preset = this.userPresets.get(id);
    if (!preset) return;
    const name = window.prompt('Rename preset', preset.name)?.trim();
    if (!name || name === preset.name) return;
    if (this.userPresets.hasName(name, id)) {
      this.notices = [`A preset named "${name}" already exists.`];
      return;
    }
    this.userPresets.update(id, { name });
    this.requestUpdate();
  }

  private onPresetUpdate(id: string): void {
    if (!this.userPresets.get(id)) return;
    this.userPresets.update(id, { cfg: this.cfgText });
    // a pane showing this preset holds a resolved copy, so it has to be re-resolved or it
    // would keep rendering the version from before the update
    void this.refreshPanes();
    this.requestUpdate();
  }

  private onPresetDelete(id: string): void {
    const preset = this.userPresets.get(id);
    if (!preset || !window.confirm(`Delete the preset "${preset.name}"?`)) return;
    this.userPresets.remove(id);
    if (this.appState.selectedPreset?.id === id) store.update({ selectedPreset: undefined });
    // a comparison pane may have been showing it; re-resolving is what falls those panes
    // back to the raw source instead of leaving them on a cached copy of a deleted preset
    void this.refreshPanes();
    this.requestUpdate();
  }

  private async onSourceFile(file: File): Promise<void> {
    try {
      this.setBaseSource(await loadImageSource(file));
      store.update({ uploadedName: file.name, sampleFile: undefined });
      this.notices = [];
    } catch (error) {
      this.notices = [`Could not load "${file.name}": ${(error as Error).message}`];
    }
  }

  /**
   * Adds shaders picked or dropped by the user.
   *
   * Each is compiled before being kept: `render()` silently skips a pass whose shader is
   * not in the cache, so an invalid shader would otherwise look like an empty pass rather
   * than an error. A failed compile is reported and nothing is saved.
   */
  private async onShaderFiles(files: File[]): Promise<void> {
    const added: string[] = [];
    const problems: string[] = [];
    for (const file of files) {
      try {
        const { name, source } = await readShaderFile(file);
        added.push(this.acceptShader(name, source));
      } catch (error) {
        problems.push(`${file.name}: ${(error as Error).message}`);
      }
    }
    this.reportShaderResult(added, problems);
  }

  private async onShaderUrl(url: string): Promise<void> {
    try {
      const { name, source } = await fetchShaderSource(url);
      this.reportShaderResult([this.acceptShader(name, source)], []);
    } catch (error) {
      this.reportShaderResult([], [(error as Error).message]);
    }
  }

  /** Compiles a candidate shader, then stores it. Throws with the compile log if invalid. */
  private acceptShader(name: string, source: string): string {
    const pipeline = this.main;
    if (pipeline) {
      const probe = `__probe__${name}`;
      const compiled = pipeline.compile(probe, source);
      const issues = compiled.issues;
      pipeline.invalidate(probe);
      if (issues.length > 0) {
        const first = issues[0];
        throw new Error(`${first.stage} shader did not compile — ${first.log.trim()}`);
      }
    }
    const entry = this.library.addFromText(name, source);
    return entry.name;
  }

  private reportShaderResult(added: string[], problems: string[]): void {
    const messages: string[] = [];
    if (added.length > 0) messages.push(`Added ${added.join(', ')}.`);
    messages.push(...problems);
    this.notices = messages;
    // the Shaders tab needs its own feedback: the log tab is a different tab, and a failed
    // add would otherwise look like nothing happened at all
    this.shaderNotice =
      messages.length === 0
        ? undefined
        : { ok: problems.length === 0, text: messages.join(' ') };
    if (added.length > 0) {
      this.requestUpdate();
      this.scheduleRender();
    }
  }

  private onShaderDelete(name: string): void {
    if (this.shadersInUse.includes(name)) {
      const message = `"${name}" is used by the current pipeline — remove that pass first.`;
      this.notices = [message];
      this.shaderNotice = { ok: false, text: message };
      return;
    }
    if (!window.confirm(`Delete the custom shader "${name}"?`)) return;
    this.library.removeCustom(name);
    for (const pipeline of this.pipelines) pipeline?.invalidate(name);
    this.notices = [`Deleted ${name}.`];
    this.shaderNotice = { ok: true, text: `Deleted ${name}.` };
    this.requestUpdate();
  }

  /** Shader names the current pipeline depends on, so they cannot be deleted under it. */
  private get shadersInUse(): string[] {
    return [...new Set(this.appState.pipeline.passes.map((pass) => pass.shader))];
  }

  /** Reveals the shader library, opening the dock if it was hidden. */
  private openShaderLibrary(): void {
    if (!this.appState.showDock) store.update({ showDock: true });
    this.shaderNotice = undefined;
    // the dock may have only just been created, so select the tab after it renders
    void this.updateComplete.then(() => this.dock?.showShaders());
  }

  private resetAll(): void {
    store.reset();
    this.syncPassParams();
    void this.refreshPanes();
    this.rebuildSource();
  }

  override render() {
    const state = this.appState;
    const hasErrors = this.issues.length > 0;

    return html`
      <header class="masthead boot" style="animation-delay:0ms">
        <a
          class="logo"
          href="https://github.com/sinedied/retroshader-lab"
          target="_blank"
          rel="noopener noreferrer"
          title="RetroShader Lab on GitHub"
        >
          <span class="mark">Retro<em>Shader</em> Lab</span>
        </a>
        <span class="spacer"></span>
        <div class="seg">
          <button
            aria-pressed=${state.showRail}
              aria-label="Toggle the bench panel"
            title="Toggle the bench panel  ( [ )"
            @click=${() => store.update({ showRail: !state.showRail })}
          >
            ◧<span class="btn-label">Bench</span>
          </button>
          <button
            aria-pressed=${state.showDock}
              aria-label="Toggle the right panel"
            title="Toggle the right panel  ( ] )"
            @click=${() => store.update({ showDock: !state.showDock })}
          >
            ◨<span class="btn-label">CFG</span>
          </button>
        </div>
        <button
          class="ghost"
          ?disabled=${!canShare()}
          aria-label="Share this setup as a link"
          title=${canShare()
            ? 'Copy a link that reproduces this setup'
            : 'This browser cannot compress a link (CompressionStream is missing)'}
          @click=${() => void this.onShare()}
        >
          ⇗<span class="btn-label">Share</span>
        </button>
        <button
          class="ghost"
          aria-label="Reset the lab"
          title="Reset the lab to its defaults"
          @click=${this.resetAll}
        >
          ↺<span class="btn-label">Reset</span>
        </button>
        <span
          class="led ${hasErrors ? 'error' : ''}"
          role="status"
          title=${hasErrors
            ? `${this.issues.length} shader compile error(s)`
            : 'All shaders compiled'}
          >${hasErrors ? `${this.issues.length} compile error(s)` : nothing}</span
        >
      </header>

      ${this.shareResult
        ? html`
            <div class="share-bar ${this.shareResult.ok ? '' : 'bad'}" role="status">
              <span class="msg">${this.shareResult.ok ? '⇗' : '⚠'} ${this.shareResult.text}</span>
              ${this.shareResult.showUrl && this.shareResult.url
                ? html`<input
                    class="share-url"
                    readonly
                    .value=${this.shareResult.url}
                    aria-label="Shareable link"
                    @focus=${(e: Event) => (e.target as HTMLInputElement).select()}
                  />`
                : nothing}
              ${this.shareResult.notes.map((note) => html`<span class="note">${note}</span>`)}
              <span class="spacer"></span>
              <button
                class="ghost"
                aria-label="Dismiss"
                @click=${() => (this.shareResult = undefined)}
              >
                ✕
              </button>
            </div>
          `
        : nothing}

      <main
        style=${`grid-template-columns:${state.showRail ? 'var(--rail)' : '0'} minmax(0, 1fr) ${
          state.showDock ? 'var(--dock)' : '0'
        }`}
      >
        <div class="rail boot" style="animation-delay:60ms" ?hidden=${!state.showRail}>
          <rsl-source-panel
            .source=${this.source}
            .system=${state.sourceSystem}
            .pattern=${state.sourcePattern}
            .sampleFile=${state.sampleFile}
            .samples=${BUNDLED_SAMPLES}
            .gbPalette=${state.gbPalette}
            .scrollEnabled=${state.scrollEnabled}
            .scrollAngle=${state.scrollAngle}
            .scrollSpeed=${state.scrollSpeed}
            @scroll-change=${(
              e: CustomEvent<{
                scrollEnabled?: boolean;
                scrollAngle?: number;
                scrollSpeed?: number;
              }>
            ) => store.update(e.detail)}
            .paletteGroups=${this.paletteGroups}
            .isGbSample=${this.gbSampleFile !== undefined}
            @gb-palette=${(e: CustomEvent<string>) => {
              store.update({ gbPalette: e.detail });
              this.rebuildSource();
            }}
            .uploadedName=${state.uploadedName}
            .outputWidth=${state.outputWidth}
            .outputHeight=${state.outputHeight}
            .scaling=${state.pipeline.scaling}
            .scaleFilter=${state.pipeline.scaleFilter}
            .coreAspect=${state.pipeline.coreAspect}
            .collapsed=${state.collapsed}
            @toggle-panel=${(e: CustomEvent<string>) => store.toggleCollapsed(e.detail)}
            @source-system=${(e: CustomEvent<string>) => {
              store.update({ sourceSystem: e.detail, sampleFile: undefined, uploadedName: undefined });
              // the core aspect follows the system, like the libretro core reporting it
              store.updatePipeline({ coreAspect: aspectOfSystem(e.detail) });
              this.rebuildSource();
            }}
            @source-pattern=${(e: CustomEvent<PatternKind>) => {
              store.update({
                sourcePattern: e.detail,
                sampleFile: undefined,
                uploadedName: undefined,
                // the scrolling field exists to be seen moving, so choosing it switches
                // motion on rather than presenting a still frame of a motion test
                ...(e.detail === 'scroll' ? { scrollEnabled: true } : {})
              });
              this.rebuildSource();
            }}
            @source-sample=${(e: CustomEvent<string>) => {
              const sample = BUNDLED_SAMPLES.find((entry) => entry.file === e.detail);
              store.update({
                sampleFile: e.detail || undefined,
                uploadedName: undefined,
                // keep the system selector in sync so switching back to a generated
                // pattern stays on the same platform
                ...(sample?.system ? { sourceSystem: sample.system } : {})
              });
              if (sample?.system) {
                store.updatePipeline({ coreAspect: aspectOfSystem(sample.system) });
              }
              this.rebuildSource();
            }}
            @source-file=${(e: CustomEvent<File>) => this.onSourceFile(e.detail)}
            @output-size=${(e: CustomEvent<{ width: number; height: number }>) =>
              store.update({
                outputWidth: Math.max(64, Math.round(e.detail.width)),
                outputHeight: Math.max(64, Math.round(e.detail.height))
              })}
            @scaling=${(e: CustomEvent<AppState['pipeline']['scaling']>) =>
              store.setScaling(e.detail)}
            @scale-filter=${(e: CustomEvent<AppState['pipeline']['scaleFilter']>) =>
              store.setScaleFilter(e.detail)}
            @core-aspect=${(e: CustomEvent<number>) =>
              store.updatePipeline({ coreAspect: e.detail })}
          ></rsl-source-panel>

          <rsl-pipeline-panel
            .passes=${state.pipeline.passes}
            .sizes=${this.passSizes}
            .shaderNames=${this.shaderNames}
            .paramsByShader=${this.paramsByShader}
            .collapsed=${state.collapsed}
            @toggle-panel=${(e: CustomEvent<string>) => store.toggleCollapsed(e.detail)}
            @pass-add=${() => {
              const passes = [...store.value.pipeline.passes, defaultPass()];
              store.updatePipeline({ passes: passes.slice(0, 3) });
              this.syncPassParams();
            }}
            @pass-remove=${(e: CustomEvent<number>) => {
              const passes = store.value.pipeline.passes.filter((_, i) => i !== e.detail);
              store.updatePipeline({ passes });
            }}
            @pass-move=${(e: CustomEvent<{ index: number; delta: number }>) => {
              const passes = [...store.value.pipeline.passes];
              const target = e.detail.index + e.detail.delta;
              if (target < 0 || target >= passes.length) return;
              [passes[e.detail.index], passes[target]] = [passes[target], passes[e.detail.index]];
              store.updatePipeline({ passes });
            }}
            @pass-change=${(e: CustomEvent<{ index: number; patch: Partial<PassConfig> }>) => {
              store.updatePass(e.detail.index, e.detail.patch);
              if (e.detail.patch.shader) this.syncPassParams();
            }}
            @pass-param=${(e: CustomEvent<{ index: number; name: string; value: number }>) =>
              store.setPassParam(e.detail.index, e.detail.name, e.detail.value)}
            @pass-params-reset=${(e: CustomEvent<number>) => this.resetPassParams(e.detail)}
            @shader-library-open=${() => this.openShaderLibrary()}
          ></rsl-pipeline-panel>

          <p class="footer-note">
            Pipeline semantics ported from NextUI <code>generic_video.c</code> /
            <code>ma_config.c</code>. Shaders are the stock <code>Shaders/glsl</code> set.
          </p>
        </div>

        <rsl-viewport
          class="boot"
          style="animation-delay:120ms"
          .width=${state.outputWidth}
          .height=${state.outputHeight}
          .viewMode=${state.viewMode}
          .zoom=${state.zoom}
          .pan=${state.pan}
          .compareMode=${state.compareMode}
          .paneCount=${state.paneCount}
          .panes=${state.panes}
          .dividers=${state.dividers}
          .compareWidth=${state.compareWidth}
          .compareHeight=${state.compareHeight}
          .exportLabels=${state.exportLabels}
          .labels=${this.paneLabels}
          .presets=${BUNDLED_PRESETS}
          .userPresets=${this.userPresets.all}
          .selectedPreset=${state.selectedPreset}
          .dstRect=${this.passSizes.length >= 0 && this.source
            ? computeDstRect(
                state.pipeline.scaling,
                this.source.width,
                this.source.height,
                state.outputWidth,
                state.outputHeight,
                state.pipeline.coreAspect
              )
            : undefined}
          .renderMs=${this.renderMs}
          @viewport-ready=${this.onViewportReady}
          @view-change=${(e: CustomEvent<Partial<AppState>>) => store.update(e.detail)}
          @compare-change=${(
            e: CustomEvent<{
              compareMode?: AppState['compareMode'];
              paneCount?: 2 | 3;
              compareWidth?: number;
              compareHeight?: number;
              exportLabels?: boolean;
            }>
          ) => {
            const { compareWidth, compareHeight, exportLabels, ...compare } = e.detail;
            if (compareWidth !== undefined || compareHeight !== undefined) {
              store.update({ compareWidth, compareHeight });
            }
            if (exportLabels !== undefined) store.update({ exportLabels });
            if (compare.compareMode !== undefined || compare.paneCount !== undefined) {
              store.setCompare(compare);
              void this.refreshPanes();
            }
          }}
          @pane-change=${(e: CustomEvent<{ index: 0 | 1; preset: string | undefined }>) => {
            store.setPane(e.detail.index, e.detail.preset);
            void this.refreshPanes();
          }}
          .canBenchmark=${this.main?.canTime ?? true}
          @benchmark-open=${() => this.openBenchmark()}
          @export-png=${(e: CustomEvent<{ composite: boolean }>) => {
            const name = [
              'retroshader',
              state.sourceSystem,
              this.exportPresetSlug,
              `${state.outputWidth}x${state.outputHeight}`
            ]
              .filter(Boolean)
              .join('-');
            if (e.detail?.composite) void this.viewport.exportComposite(`${name}-compare.png`);
            else this.viewport.exportPng(`${name}.png`);
          }}
        ></rsl-viewport>

        <rsl-dock
          class="boot"
          style="animation-delay:180ms"
          ?hidden=${!state.showDock}
          .cfgText=${this.cfgText}
          .presets=${BUNDLED_PRESETS}
          .userPresets=${this.userPresets.all}
          .selectedPreset=${state.selectedPreset}
          .passes=${this.passInfos}
          .issues=${this.issues}
          .warnings=${[...this.notices, ...this.warnings]}
          .shaders=${this.library.all.filter((entry) => entry.name !== FINAL_SHADER)}
          .shadersInUse=${this.shadersInUse}
          .shaderNotice=${this.shaderNotice}
          @shader-add-file=${(e: CustomEvent<File[]>) => void this.onShaderFiles(e.detail)}
          @shader-add-url=${(e: CustomEvent<string>) => void this.onShaderUrl(e.detail)}
          @shader-delete=${(e: CustomEvent<string>) => this.onShaderDelete(e.detail)}
          @cfg-import=${(e: CustomEvent<string>) => this.onCfgImport(e.detail)}
          @preset-load=${(e: CustomEvent<{ kind: string; id: string }>) =>
            this.onPresetLoad(e.detail)}
          @preset-save=${() => this.onPresetSave()}
          @preset-rename=${(e: CustomEvent<string>) => this.onPresetRename(e.detail)}
          @preset-update=${(e: CustomEvent<string>) => this.onPresetUpdate(e.detail)}
          @preset-delete=${(e: CustomEvent<string>) => this.onPresetDelete(e.detail)}
        ></rsl-dock>

        <rsl-benchmark
          .results=${this.benchmarkResults}
          .running=${this.benchmarkRunning}
          .progress=${this.benchmarkProgress}
          .quality=${this.benchmarkQuality}
          .note=${`${state.outputWidth}×${state.outputHeight}`}
          @benchmark-rerun=${() => this.runPaneBenchmark()}
          @benchmark-quality=${(e: CustomEvent<BenchmarkQuality>) => {
            this.benchmarkQuality = e.detail;
            void this.runPaneBenchmark();
          }}
          @benchmark-close=${() => (this.benchmarkCancelled = true)}
        ></rsl-benchmark>
      </main>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rsl-app': RslApp;
  }
}
