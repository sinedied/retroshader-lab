import { LitElement, html, css } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { panelStyles, bootStyles } from './shared-styles.js';
import './rsl-source-panel.js';
import './rsl-pipeline-panel.js';
import './rsl-viewport.js';
import './rsl-dock.js';
import type { RslViewport } from './rsl-viewport.js';
import {
  ShaderPipeline,
  computePassSizes,
  type PassRenderInfo,
  type RenderResult
} from '../core/pipeline.js';
import { panePipelineConfig } from '../core/preset-config.js';
import {
  ShaderLibrary,
  FINAL_SHADER,
  BUNDLED_SAMPLES,
  BUNDLED_PRESETS,
  loadPreset
} from '../core/shader-library.js';
import { computeDstRect } from '../core/scaling.js';
import { exportCfg, importCfg } from '../core/cfg.js';
import { defaultValue, isConfigurable, quantize } from '../core/pragma-params.js';
import { store, defaultPass, type AppState } from '../core/state.js';
import {
  SYSTEM_RESOLUTIONS,
  loadImageSource,
  makeGeneratedSource,
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

@customElement('rsl-app')
export class RslApp extends LitElement {
  static override styles = [
    panelStyles,
    bootStyles,
    css`
      :host {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        height: 100%;
        min-height: 0;
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
      }

      .logo .sub {
        font-size: 10px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: var(--ink-faint);
        font-family: var(--font-display);
        font-variation-settings: 'wdth' 108, 'wght' 500;
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
      }

      .led::before {
        content: '';
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--phosphor);
        box-shadow: 0 0 10px var(--phosphor);
        animation: pulse 2.6s ease-in-out infinite;
      }

      .led.error::before {
        background: var(--danger);
        box-shadow: 0 0 10px var(--danger);
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.35;
        }
      }

      main {
        display: grid;
        grid-template-columns: var(--rail) minmax(0, 1fr) var(--dock);
        grid-template-rows: minmax(0, 1fr);
        min-height: 0;
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

  @state() private appState: AppState = store.value;
  @state() private source: SourceImage | undefined = undefined;
  @state() private passInfos: PassRenderInfo[] = [];
  @state() private issues: CompileIssue[] = [];
  @state() private warnings: string[] = [];
  @state() private renderMs = 0;
  @state() private ready = false;
  /** Messages from user actions (import, preset, upload); render warnings are separate
      because every render replaces them. */
  @state() private notices: string[] = [];

  private readonly library = new ShaderLibrary();
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
      this.appState = state;
      this.scheduleRender();
    });
    window.addEventListener('keydown', this.onKeyDown);
    await this.library.load();
    this.ready = true;
    // Passes restored from localStorage (or the defaults) may predate the shader
    // metadata, so fill in every declared parameter with its NextUI default.
    this.syncPassParams();
    void this.refreshPanes();
    this.rebuildSource();
  }

  override disconnectedCallback(): void {
    this.unsubscribe?.();
    window.removeEventListener('keydown', this.onKeyDown);
    super.disconnectedCallback();
  }

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
  private async refreshPanes(): Promise<void> {
    const state = this.appState;
    const paramsOf = (shader: string) => this.library.paramsOf(shader);
    try {
      this.paneConfigs = await Promise.all(
        state.panes.map((pane) =>
          pane.preset ? panePipelineConfig(pane.preset, state.pipeline, paramsOf) : undefined
        )
      );
    } catch (error) {
      this.notices = [`Could not load a comparison preset: ${(error as Error).message}`];
      return;
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

  private rebuildSource(): void {
    const state = this.appState;
    if (state.sampleFile) {
      const url = `${import.meta.env.BASE_URL}samples/${state.sampleFile}`;
      void loadImageSource(url, state.sampleFile)
        .then((source) => {
          this.source = source;
          this.scheduleRender();
        })
        .catch((error: Error) => {
          this.notices = [`Could not load sample "${state.sampleFile}": ${error.message}`];
        });
      return;
    }
    const system =
      SYSTEM_RESOLUTIONS.find((s) => s.id === state.sourceSystem) ?? SYSTEM_RESOLUTIONS[0];
    this.source = makeGeneratedSource(system, state.sourcePattern);
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.renderPipeline();
    });
  }

  /** Compiles anything the pipeline needs, then renders both canvases. */
  private renderPipeline(): void {
    if (!this.main || !this.source || !this.ready) return;
    const state = this.appState;
    const paneCount = state.compareMode === 'off' ? 1 : state.paneCount;

    // Pane 0 is the edited pipeline, the others come from the pane selection. Preset
    // panes inherit the geometry so only the shaders differ between panes.
    const configs: PipelineConfig[] = [state.pipeline];
    for (let i = 1; i < paneCount; i++) {
      const resolved = this.paneConfigs[i - 1];
      configs.push(
        resolved
          ? {
              ...resolved,
              scaling: state.pipeline.scaling,
              coreAspect: state.pipeline.coreAspect,
              frameCount: state.pipeline.frameCount
            }
          : { ...state.pipeline, passes: [] }
      );
    }

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

    store.update({ cfgExtras: imported.extras });
    store.updatePipeline({
      passes,
      ...(imported.scaling ? { scaling: imported.scaling } : {}),
      ...(imported.scaleFilter ? { scaleFilter: imported.scaleFilter } : {})
    });
    this.notices = [...imported.warnings];
  }

  private async onPresetLoad(path: string): Promise<void> {
    try {
      this.onCfgImport(await loadPreset(path));
    } catch (error) {
      this.notices = [`Could not load preset "${path}": ${(error as Error).message}`];
    }
  }

  private async onSourceFile(file: File): Promise<void> {
    try {
      this.source = await loadImageSource(file);
      store.update({ uploadedName: file.name, sampleFile: undefined });
      this.notices = [];
    } catch (error) {
      this.notices = [`Could not load "${file.name}": ${(error as Error).message}`];
    }
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
        <div class="logo">
          <span class="mark">Retro<em>Shader</em> Lab</span>
          <span class="sub">NextUI · shader pipeline bench</span>
        </div>
        <span class="spacer"></span>
        <div class="seg">
          <button
            aria-pressed=${state.showRail}
              title="Toggle the left panel  ( [ )"
            @click=${() => store.update({ showRail: !state.showRail })}
          >
            ▤ Panels
          </button>
          <button
            aria-pressed=${state.showDock}
              title="Toggle the right panel  ( ] )"
            @click=${() => store.update({ showDock: !state.showDock })}
          >
            ▤ CFG
          </button>
        </div>
        <span class="chip">${this.shaderNames.length} shaders</span>
        <button class="ghost" title="Reset the lab to its defaults" @click=${this.resetAll}>
          ↺ Reset
        </button>
        <span class="led ${hasErrors ? 'error' : ''}">
          ${hasErrors ? `${this.issues.length} compile error(s)` : 'signal ok'}
        </span>
      </header>

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
              this.rebuildSource();
            }}
            @source-pattern=${(e: CustomEvent<PatternKind>) => {
              store.update({
                sourcePattern: e.detail,
                sampleFile: undefined,
                uploadedName: undefined
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
          .presets=${BUNDLED_PRESETS}
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
          @compare-change=${(e: CustomEvent<{ compareMode?: AppState['compareMode']; paneCount?: 2 | 3 }>) => {
            store.setCompare(e.detail);
            void this.refreshPanes();
          }}
          @pane-change=${(e: CustomEvent<{ index: 0 | 1; preset: string | undefined }>) => {
            store.setPane(e.detail.index, e.detail.preset);
            void this.refreshPanes();
          }}
          @export-png=${(e: CustomEvent<{ composite: boolean }>) => {
            const name = `retroshader-${state.sourceSystem}-${state.outputWidth}x${state.outputHeight}`;
            if (e.detail?.composite) this.viewport.exportComposite(`${name}-compare.png`);
            else this.viewport.exportPng(`${name}.png`);
          }}
        ></rsl-viewport>

        <rsl-dock
          class="boot"
          style="animation-delay:180ms"
          ?hidden=${!state.showDock}
          .cfgText=${this.cfgText}
          .presets=${BUNDLED_PRESETS}
          .passes=${this.passInfos}
          .issues=${this.issues}
          .warnings=${[...this.notices, ...this.warnings]}
          @cfg-import=${(e: CustomEvent<string>) => this.onCfgImport(e.detail)}
          @preset-load=${(e: CustomEvent<string>) => this.onPresetLoad(e.detail)}
        ></rsl-dock>
      </main>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rsl-app': RslApp;
  }
}
