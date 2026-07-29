import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, query, queryAll, state } from 'lit/decorators.js';
import { panelStyles } from './shared-styles.js';
import { paneLabel } from '../core/preset-config.js';
import type { Rect } from '../core/types.js';
import type { CompareMode, ComparePane } from '../core/state.js';

const ZOOM_LEVELS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16];
const STAGE_PADDING = 44;

/**
 * Render viewport. Owns one WebGL canvas per comparison pane and lays them out in one of
 * three ways:
 *
 *   off           a single pane filling the stage
 *   overlay       panes stacked, each clipped to the band between two dividers, so the
 *                 result reads as one continuous image
 *   side-by-side  the stage split into equal fixed columns, every column showing the *same*
 *                 scene region of a different pane
 *
 * Both modes share one structure: a full-height "pane layer" per pane, with the scene
 * centred inside it and offset by the shared pan. In overlay the layers span the whole
 * stage and are clipped; in side-by-side they are columns that crop by overflow.
 *
 * The canvas backing store is always the output resolution and zoom is pure CSS with
 * `image-rendering: pixelated`, so a 1:1 export is a byte-exact capture.
 */
@customElement('rsl-viewport')
export class RslViewport extends LitElement {
  static override styles = [
    panelStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        height: 100%;
        /* if wrapping toolbars ever need more room than the row has, scroll
           rather than squeezing the stage away */
        overflow-y: auto;
      }

      .bar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 7px 9px;
        min-width: 0;
        border-bottom: 1px solid var(--line);
        background: linear-gradient(180deg, var(--panel-2), var(--panel));
        flex: 0 0 auto;
        flex-wrap: wrap;
      }

      .bar.compare {
        background: rgba(125, 255, 155, 0.04);
      }

      .bar .seg {
        flex: 0 0 auto;
      }

      .bar .seg button {
        padding: 5px 8px;
      }

      .spacer {
        flex: 1;
      }

      .pane-pick {
        display: flex;
        align-items: center;
        gap: 5px;
        flex: 0 1 auto;
        min-width: 0;
      }

      .pane-pick select {
        width: auto;
        min-width: 120px;
        max-width: 210px;
        padding-top: 4px;
        padding-bottom: 4px;
      }

      .tag {
        font-family: var(--font-display);
        font-variation-settings: 'wdth' 118, 'wght' 700;
        font-size: 10px;
        letter-spacing: 0.1em;
        color: #04120a;
        background: var(--phosphor);
        border-radius: 2px;
        padding: 1px 5px;
      }

      .tag.b {
        background: var(--amber);
        color: #1a1200;
      }

      .tag.c {
        background: #7db4ff;
        color: #04101f;
      }

      .stage {
        position: relative;
        flex: 1 1 auto;
        /* never let the preview be squeezed to nothing by wrapping toolbars */
        min-height: 180px;
        overflow: hidden;
        background-color: #020403;
        background-image: linear-gradient(45deg, #0a0f0d 25%, transparent 25%),
          linear-gradient(-45deg, #0a0f0d 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #0a0f0d 75%),
          linear-gradient(-45deg, transparent 75%, #0a0f0d 75%);
        background-size: 16px 16px;
        background-position: 0 0, 0 8px, 8px -8px, -8px 0;
        cursor: grab;
        touch-action: none;
      }

      .stage.grabbing {
        cursor: grabbing;
      }

      .pane {
        position: absolute;
        top: 0;
        bottom: 0;
        overflow: hidden;
      }

      canvas {
        position: absolute;
        display: block;
        image-rendering: pixelated;
        background: #000;
        box-shadow: 0 0 0 1px var(--line-strong), 0 28px 70px -40px rgba(125, 255, 155, 0.5);
      }

      .pane-label {
        position: absolute;
        top: 8px;
        z-index: 4;
        pointer-events: none;
      }

      .divider {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 13px;
        margin-left: -6px;
        z-index: 5;
        display: grid;
        place-items: center;
      }

      .divider.movable {
        cursor: ew-resize;
      }

      .divider::before {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        width: 1px;
        background: var(--amber);
        box-shadow: 0 0 12px rgba(255, 180, 84, 0.9);
      }

      .divider.fixed::before {
        background: var(--line-strong);
        box-shadow: none;
      }

      .divider .grip {
        position: relative;
        width: 5px;
        height: 34px;
        border-radius: 3px;
        background: var(--amber);
        box-shadow: 0 0 10px rgba(255, 180, 84, 0.7);
      }

      .status {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        padding: 6px 10px;
        border-top: 1px solid var(--line);
        background: linear-gradient(0deg, var(--panel-2), var(--panel));
        flex: 0 0 auto;
      }

      .zoom-readout {
        font-variant-numeric: tabular-nums;
        color: var(--phosphor);
        min-width: 52px;
        text-align: center;
        font-size: 11px;
      }
    `
  ];

  @property({ type: Number }) width = 1024;
  @property({ type: Number }) height = 768;
  @property({ type: String }) viewMode: 'fit' | 'zoom' = 'zoom';
  @property({ type: Number }) zoom = 1;
  @property({ attribute: false }) pan: { x: number; y: number } = { x: 0, y: 0 };
  @property({ type: String }) compareMode: CompareMode = 'off';
  @property({ type: Number }) paneCount: 2 | 3 = 2;
  @property({ attribute: false }) panes: ComparePane[] = [];
  @property({ attribute: false }) dividers: number[] = [0.5];
  @property({ attribute: false }) presets: string[] = [];
  @property({ attribute: false }) dstRect: Rect | undefined = undefined;
  @property({ type: Number }) renderMs = 0;

  @state() private fitScale = 1;
  @state() private grabbing = false;

  @query('.stage') private stage!: HTMLDivElement;
  @queryAll('canvas') private canvasList!: NodeListOf<HTMLCanvasElement>;

  private resizeObserver: ResizeObserver | undefined;

  /** All pane canvases, in pane order. */
  get canvases(): HTMLCanvasElement[] {
    return [...this.canvasList];
  }

  /** Panes currently on screen: 1 when not comparing, otherwise `paneCount`. */
  private get visiblePanes(): number {
    return this.compareMode === 'off' ? 1 : this.paneCount;
  }

  /** Evenly spaced dividers, the same spacing the store uses when the pane count changes. */
  private get evenDividers(): number[] {
    const panes = this.visiblePanes;
    return Array.from({ length: panes - 1 }, (_, i) => (i + 1) / panes);
  }

  private get dividersAreEven(): boolean {
    const even = this.evenDividers;
    return (
      this.dividers.length === even.length &&
      even.every((position, i) => Math.abs(position - this.dividers[i]) < 0.001)
    );
  }

  private get scale(): number {
    return this.viewMode === 'fit' ? this.fitScale : this.zoom;
  }

  /** Width of the window each pane shows, which is what panning is clamped against. */
  private get paneWidth(): number {
    const stageWidth = this.stage?.clientWidth ?? this.width;
    return this.compareMode === 'side-by-side' ? stageWidth / this.visiblePanes : stageWidth;
  }

  override firstUpdated(): void {
    // The observer fires during layout, so defer the state write to the next frame to
    // avoid scheduling a Lit update from inside an update cycle.
    this.resizeObserver = new ResizeObserver(() =>
      requestAnimationFrame(() => this.updateFitScale())
    );
    this.resizeObserver.observe(this.stage);
    requestAnimationFrame(() => this.updateFitScale());
    // Hand the canvases over outside the update cycle so the app's reaction cannot
    // schedule a Lit update from within this one.
    queueMicrotask(() =>
      this.dispatchEvent(
        new CustomEvent('viewport-ready', {
          detail: this.canvases,
          bubbles: true,
          composed: true
        })
      )
    );
  }

  override disconnectedCallback(): void {
    this.resizeObserver?.disconnect();
    super.disconnectedCallback();
  }

  override updated(changed: Map<string, unknown>): void {
    // Deferred: recomputing the fit scale writes reactive state, which Lit rejects
    // from inside an update cycle.
    if (changed.has('width') || changed.has('height')) {
      requestAnimationFrame(() => this.updateFitScale());
    }
  }

  /** Fit always targets the whole stage, even when it is split into columns. */
  private updateFitScale(): void {
    if (!this.stage) return;
    const availableW = Math.max(64, this.stage.clientWidth - STAGE_PADDING);
    const availableH = Math.max(64, this.stage.clientHeight - STAGE_PADDING);
    const scale = Math.min(availableW / this.width, availableH / this.height, 1);
    if (Math.abs(scale - this.fitScale) > 0.0001) this.fitScale = scale;
  }

  private emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /** Keeps the scene from being dragged out of the window a pane shows. */
  private clampPan(pan: { x: number; y: number }): { x: number; y: number } {
    const scale = this.scale;
    const maxX = Math.max(0, (this.width * scale - this.paneWidth) / 2);
    const maxY = Math.max(0, (this.height * scale - (this.stage?.clientHeight ?? 0)) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, pan.x)),
      y: Math.min(maxY, Math.max(-maxY, pan.y))
    };
  }

  private setZoom(zoom: number): void {
    this.emit('view-change', {
      viewMode: 'zoom',
      zoom,
      pan: this.clampPanFor(zoom, this.pan)
    });
  }

  private clampPanFor(zoom: number, pan: { x: number; y: number }): { x: number; y: number } {
    const maxX = Math.max(0, (this.width * zoom - this.paneWidth) / 2);
    const maxY = Math.max(0, (this.height * zoom - (this.stage?.clientHeight ?? 0)) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, pan.x)),
      y: Math.min(maxY, Math.max(-maxY, pan.y))
    };
  }

  private stepZoom(delta: number): void {
    const current = this.scale;
    const index = ZOOM_LEVELS.findIndex((z) => z >= current - 0.001);
    const next = ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, index + delta))];
    this.setZoom(next);
  }

  private onPan(event: PointerEvent): void {
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { ...this.pan };
    this.grabbing = true;
    const move = (e: PointerEvent) => {
      this.emit(
        'view-change',
        { pan: this.clampPan({ x: origin.x + (e.clientX - startX), y: origin.y + (e.clientY - startY) }) }
      );
    };
    const up = () => {
      this.grabbing = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    event.preventDefault();
  }

  private onDividerDrag(event: PointerEvent, index: number): void {
    event.stopPropagation();
    event.preventDefault();
    const move = (e: PointerEvent) => {
      const rect = this.stage.getBoundingClientRect();
      const position = (e.clientX - rect.left) / rect.width;
      const dividers = [...this.dividers];
      const lower = index === 0 ? 0.02 : dividers[index - 1] + 0.02;
      const upper = index === dividers.length - 1 ? 0.98 : dividers[index + 1] - 0.02;
      dividers[index] = Math.min(upper, Math.max(lower, position));
      this.emit('view-change', { dividers });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** Label shown over a pane: pane 0 is always the pipeline being edited. */
  private labelFor(index: number): string {
    if (index === 0) return 'Current';
    return paneLabel(this.panes[index - 1]?.preset);
  }

  /** Layer geometry for a pane, in the two comparison layouts. */
  private paneStyle(index: number): string {
    const panes = this.visiblePanes;
    if (this.compareMode === 'side-by-side') {
      const width = 100 / panes;
      return `left:${(index * width).toFixed(4)}%;width:${width.toFixed(4)}%`;
    }
    const start = index === 0 ? 0 : this.dividers[index - 1];
    const end = index === panes - 1 ? 1 : this.dividers[index];
    const clip =
      panes > 1
        ? `;clip-path:inset(0 ${((1 - end) * 100).toFixed(4)}% 0 ${(start * 100).toFixed(4)}%)`
        : '';
    return `left:0;width:100%${clip}`;
  }

  /** The scene is centred inside its own layer, then offset by the shared pan. */
  private canvasStyle(): string {
    const scale = this.scale;
    const w = Math.round(this.width * scale);
    const h = Math.round(this.height * scale);
    return `width:${w}px;height:${h}px;left:calc(50% - ${w / 2}px + ${this.pan.x}px);top:calc(50% - ${h / 2}px + ${this.pan.y}px)`;
  }

  private labelStyle(index: number): string {
    if (this.compareMode === 'side-by-side') {
      return `left:calc(${((index / this.visiblePanes) * 100).toFixed(4)}% + 10px)`;
    }
    if (index === 0) return 'left:10px';
    const start = this.dividers[index - 1] ?? 0;
    return `left:calc(${(start * 100).toFixed(4)}% + 10px)`;
  }

  /** Downloads a single pane as a 1:1 PNG. */
  exportPng(fileName: string, paneIndex = 0): void {
    this.canvases[paneIndex]?.toBlob((blob) => {
      if (blob) this.download(blob, fileName);
    }, 'image/png');
  }

  /**
   * Downloads the comparison exactly as laid out, at the output resolution: bands for
   * overlay, equal columns cropped around the current pan for side-by-side.
   */
  exportComposite(fileName: string): void {
    const panes = this.visiblePanes;
    if (this.compareMode === 'off' || panes < 2) {
      this.exportPng(fileName);
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const sources = this.canvases;
    if (this.compareMode === 'overlay') {
      for (let i = 0; i < panes; i++) {
        const start = i === 0 ? 0 : this.dividers[i - 1];
        const end = i === panes - 1 ? 1 : this.dividers[i];
        const x = Math.round(start * this.width);
        const w = Math.round((end - start) * this.width);
        if (w > 0 && sources[i]) ctx.drawImage(sources[i], x, 0, w, this.height, x, 0, w, this.height);
      }
    } else {
      const scale = this.scale;
      const colWidth = this.width / panes;
      // same centring rule as on screen, expressed in output pixels
      const sourceX = (this.width - colWidth) / 2 - this.pan.x / scale;
      const sourceY = -this.pan.y / scale;
      for (let i = 0; i < panes; i++) {
        if (!sources[i]) continue;
        ctx.drawImage(
          sources[i],
          sourceX,
          sourceY,
          colWidth,
          this.height,
          Math.round(i * colWidth),
          0,
          Math.round(colWidth),
          this.height
        );
      }
    }

    canvas.toBlob((blob) => {
      if (blob) this.download(blob, fileName);
    }, 'image/png');
  }

  private download(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  private renderPanePicker(index: 0 | 1) {
    const pane = this.panes[index];
    const letter = index === 0 ? 'b' : 'c';
    return html`
      <div class="pane-pick">
        <span class="tag ${letter}">${letter.toUpperCase()}</span>
        <select
          name=${`pane-${letter}`}
          aria-label=${`Pane ${letter.toUpperCase()} content`}
          @change=${(e: Event) =>
            this.emit('pane-change', {
              index,
              preset: (e.target as HTMLSelectElement).value || undefined
            })}
        >
          <option value="" ?selected=${!pane?.preset}>Raw (no shader)</option>
          ${this.presets.map(
            (path) => html`
              <option value=${path} ?selected=${path === pane?.preset}>
                ${path.replace(/\.cfg$/, '')}
              </option>
            `
          )}
        </select>
      </div>
    `;
  }

  private renderCompareBar() {
    return html`
      <div class="bar compare">
        <div class="seg">
          <button
            aria-pressed=${this.compareMode === 'overlay'}
            aria-label="Overlay comparison"
            title="Panes clipped by a movable divider, forming one image"
            @click=${() => this.emit('compare-change', { compareMode: 'overlay' })}
          >
            ◧<span class="btn-label">Overlay</span>
          </button>
          <button
            aria-pressed=${this.compareMode === 'side-by-side'}
            aria-label="Side by side comparison"
            title="Panes side by side, showing the same region"
            @click=${() => this.emit('compare-change', { compareMode: 'side-by-side' })}
          >
            ▥<span class="btn-label">Side by side</span>
          </button>
        </div>
        <div class="seg">
          <button
            aria-pressed=${this.paneCount === 2}
            @click=${() => this.emit('compare-change', { paneCount: 2 })}
          >
            2
          </button>
          <button
            aria-pressed=${this.paneCount === 3}
            @click=${() => this.emit('compare-change', { paneCount: 3 })}
          >
            3
          </button>
        </div>
        ${this.renderPanePicker(0)} ${this.paneCount === 3 ? this.renderPanePicker(1) : nothing}
        <span class="spacer"></span>
        ${this.compareMode === 'overlay'
          ? html`
              <button
                class="ghost"
                ?disabled=${this.dividersAreEven}
                aria-label="Reset the dividers"
                title="Reset the dividers to evenly spaced"
                @click=${() => this.emit('view-change', { dividers: this.evenDividers })}
              >
                ↺<span class="btn-label">Dividers</span>
              </button>
            `
          : nothing}
        <button
          class="ghost"
          aria-label="Close comparison"
          title="Close comparison"
          @click=${() => this.emit('compare-change', { compareMode: 'off' })}
        >
          ✕<span class="btn-label">Close</span>
        </button>
      </div>
    `;
  }

  override render() {
    const scale = this.scale;
    const rect = this.dstRect;
    const panes = this.visiblePanes;
    const comparing = this.compareMode !== 'off';
    const dividers = this.compareMode === 'side-by-side'
      ? Array.from({ length: panes - 1 }, (_, i) => (i + 1) / panes)
      : this.dividers.slice(0, panes - 1);

    return html`
      <div class="bar">
        <div class="seg">
          <button
            aria-pressed=${this.viewMode === 'fit'}
            title="Fit the whole scene in the stage"
            @click=${() => this.emit('view-change', { viewMode: 'fit', pan: { x: 0, y: 0 } })}
          >
            Fit
          </button>
          <button
            aria-pressed=${this.viewMode === 'zoom' && Math.abs(this.zoom - 1) < 0.001}
            @click=${() => this.setZoom(1)}
          >
            1:1
          </button>
          <button
            aria-pressed=${this.viewMode === 'zoom' && Math.abs(this.zoom - 2) < 0.001}
            @click=${() => this.setZoom(2)}
          >
            2:1
          </button>
          <button
            aria-pressed=${this.viewMode === 'zoom' && Math.abs(this.zoom - 4) < 0.001}
            @click=${() => this.setZoom(4)}
          >
            4:1
          </button>
        </div>

        <div class="seg">
          <button title="Zoom out" @click=${() => this.stepZoom(-1)}>−</button>
          <button class="zoom-readout" title="Reset to 1:1" @click=${() => this.setZoom(1)}>
            ${(scale * 100).toFixed(0)}%
          </button>
          <button title="Zoom in" @click=${() => this.stepZoom(1)}>+</button>
        </div>

        <button
          class="ghost"
          aria-pressed=${comparing}
          title="Compare the edited pipeline with presets or the raw source"
          aria-label="Compare pipelines"
          @click=${() =>
            this.emit('compare-change', { compareMode: comparing ? 'off' : 'overlay' })}
        >
          ⇄<span class="btn-label">Compare</span>
        </button>

        <span class="spacer"></span>

        ${comparing
          ? html`
              <button
                aria-label="Download the current pipeline as PNG"
                title="Download the current pipeline only"
                @click=${() => this.emit('export-png', { composite: false })}
              >
                ⇩<span class="btn-label">Current</span>
              </button>
            `
          : nothing}
        <button
          class="primary"
          aria-label="Export PNG at 1:1"
          title="Export a 1:1 PNG"
          @click=${() => this.emit('export-png', { composite: comparing })}
        >
          ⇩<span class="btn-label">Export PNG 1:1</span>
        </button>
      </div>

      ${comparing ? this.renderCompareBar() : nothing}

      <div
        class="stage ${this.grabbing ? 'grabbing' : ''}"
        @pointerdown=${this.onPan}
      >
        ${[0, 1, 2].map(
          (index) => html`
            <div
              class="pane"
              style=${`${this.paneStyle(index)}${index < panes ? '' : ';display:none'}`}
            >
              <canvas width=${this.width} height=${this.height} style=${this.canvasStyle()}></canvas>
            </div>
          `
        )}
        ${comparing
          ? [0, 1, 2]
              .slice(0, panes)
              .map(
                (index) => html`
                  <span
                    class="pane-label tag ${index === 0 ? '' : index === 1 ? 'b' : 'c'}"
                    style=${this.labelStyle(index)}
                    >${this.labelFor(index)}</span
                  >
                `
              )
          : nothing}
        ${dividers.map(
          (position, index) => html`
            <div
              class="divider ${this.compareMode === 'overlay' ? 'movable' : 'fixed'}"
              style=${`left:${(position * 100).toFixed(4)}%`}
              @pointerdown=${(e: PointerEvent) =>
                this.compareMode === 'overlay' ? this.onDividerDrag(e, index) : undefined}
            >
              ${this.compareMode === 'overlay' ? html`<span class="grip"></span>` : nothing}
            </div>
          `
        )}
      </div>

      <div class="status">
        <span class="chip">Screen <b>${this.width}×${this.height}</b></span>
        ${rect
          ? html`<span class="chip">
              dst_rect <b>${rect.w}×${rect.h}</b> @ ${rect.x},${rect.y}
            </span>`
          : nothing}
        <span class="chip">Zoom <b>${(scale * 100).toFixed(0)}%</b></span>
        ${comparing
          ? html`<span class="chip">Panes <b>${panes}</b> · ${this.compareMode}</span>`
          : nothing}
        <span class="spacer"></span>
        <span class="chip">Frame <b>${this.renderMs.toFixed(1)} ms</b></span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rsl-viewport': RslViewport;
  }
}
