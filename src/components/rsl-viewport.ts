import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, query, queryAll, state } from 'lit/decorators.js';
import { panelStyles } from './shared-styles.js';
import { paneLabel } from '../core/preset-config.js';
import type { Rect } from '../core/types.js';
import type { CompareMode, ComparePane } from '../core/state.js';

const ZOOM_LEVELS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16];
const STAGE_PADDING = 44;

/** Matches the `.tag` colours so a burnt-in label looks like the on-screen one. */
const LABEL_COLORS = [
  { bg: '#7dff9b', fg: '#04120a' },
  { bg: '#ffb454', fg: '#1a1200' },
  { bg: '#7db4ff', fg: '#04101f' }
];
/** Mirrors `--font-display` so a burnt-in label matches the on-screen one. */
const LABEL_FONT = "'Archivo', 'Helvetica Neue', sans-serif";

/** Handy comparison shapes: wide strips for side-by-side, plus common capture sizes. */
const FRAME_PRESETS: [number, number][] = [
  [1200, 400],
  [1920, 640],
  [1280, 720],
  [1920, 1080],
  [1024, 768]
];

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

      .frame-pick {
        display: flex;
        align-items: center;
        gap: 5px;
        flex: 0 1 auto;
        min-width: 0;
      }

      .frame-pick select {
        width: auto;
        min-width: 96px;
        max-width: 190px;
        padding-top: 4px;
        padding-bottom: 4px;
      }

      .frame-pick input.num {
        width: 62px;
        padding-top: 4px;
        padding-bottom: 4px;
        text-align: right;
      }

      /* .label is a block by default, which would break the toolbar row */
      .label.inline {
        display: inline-block;
        margin-bottom: 0;
        white-space: nowrap;
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

      /**
       * The comparison frame: the rectangle the panes divide, and exactly what the
       * composite export writes. Sized in export pixels, then scaled down only if it
       * cannot fit the stage.
       */
      .frame {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        overflow: hidden;
        background: #000;
        box-shadow: 0 0 0 1px var(--line-strong), 0 28px 70px -40px rgba(125, 255, 155, 0.5);
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

      /* inside the frame the canvas is a crop, so it must not paint its own border */
      .frame canvas {
        box-shadow: none;
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
  @property({ type: Number }) compareWidth = 0;
  @property({ type: Number }) compareHeight = 0;
  @property({ type: Boolean }) exportLabels = true;
  /** Pane labels resolved by the app, which knows the saved preset names. */
  @property({ attribute: false }) labels: string[] = [];
  @property({ attribute: false }) presets: string[] = [];
  @property({ attribute: false }) dstRect: Rect | undefined = undefined;
  @property({ type: Number }) renderMs = 0;
  /** False when the GPU timer extension is missing, so benchmarking is impossible. */
  @property({ type: Boolean }) canBenchmark = true;

  @state() private fitScale = 1;
  @state() private grabbing = false;

  @query('.stage') private stage!: HTMLDivElement;
  @query('.frame') private frame!: HTMLDivElement | null;
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

  /** True while the comparison frame governs the layout. */
  private get framed(): boolean {
    return this.compareMode !== 'off';
  }

  /** The comparison frame in export pixels; falls back to the output resolution. */
  private get frameW(): number {
    return this.framed && this.compareWidth > 0 ? this.compareWidth : this.width;
  }

  private get frameH(): number {
    return this.framed && this.compareHeight > 0 ? this.compareHeight : this.height;
  }

  /**
   * How much the frame is shrunk purely to fit on screen. Capped at 1 so the frame is
   * pixel-exact whenever it fits, and the export never depends on the window size.
   */
  private get displayScale(): number {
    if (!this.framed) return 1;
    const availableW = Math.max(64, (this.stage?.clientWidth ?? this.frameW) - STAGE_PADDING);
    const availableH = Math.max(64, (this.stage?.clientHeight ?? this.frameH) - STAGE_PADDING);
    return Math.min(1, availableW / this.frameW, availableH / this.frameH);
  }

  /** Width of the window a single pane shows, in frame pixels. */
  private get paneWindowW(): number {
    return this.compareMode === 'side-by-side' ? this.frameW / this.visiblePanes : this.frameW;
  }

  /**
   * Width of the window each pane shows, which is what panning is clamped against.
   *
   * Outside the comparison this is the stage, as before. Inside it, it is the frame — the
   * clamp must not depend on the browser window, or the export would only match the screen
   * by coincidence and the pannable range would shift whenever the window is resized.
   */
  private get paneWidth(): number {
    if (this.framed) return this.paneWindowW;
    const stageWidth = this.stage?.clientWidth ?? this.width;
    return stageWidth;
  }

  /** Height of the window a pane shows, in the same coordinates as `paneWidth`. */
  private get paneHeight(): number {
    return this.framed ? this.frameH : (this.stage?.clientHeight ?? this.height);
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
    const geometryChanged =
      changed.has('width') ||
      changed.has('height') ||
      changed.has('compareWidth') ||
      changed.has('compareHeight') ||
      changed.has('compareMode') ||
      changed.has('paneCount');

    if (geometryChanged) {
      requestAnimationFrame(() => {
        this.updateFitScale();
        // Anything that resizes the window a pane shows can leave an existing pan out of
        // range — dragging to the edge of a narrow frame and then widening it used to
        // leave the render short of its column, as a black gap on screen and in the
        // export. The clamp only ran on drag and zoom, so nothing re-checked it.
        const clamped = this.clampPan(this.pan);
        if (Math.abs(clamped.x - this.pan.x) > 0.01 || Math.abs(clamped.y - this.pan.y) > 0.01) {
          this.emit('view-change', { pan: clamped });
        }
      });
    }
  }

  /**
   * Fit targets the whole stage normally, and the pane's window inside the frame while
   * comparing — the frame is in export pixels, so fitting to the stage would make the
   * exported result depend on the window size.
   */
  private updateFitScale(): void {
    if (!this.stage) return;
    const availableW = this.framed
      ? this.paneWindowW
      : Math.max(64, this.stage.clientWidth - STAGE_PADDING);
    const availableH = this.framed
      ? this.frameH
      : Math.max(64, this.stage.clientHeight - STAGE_PADDING);
    const scale = Math.min(availableW / this.width, availableH / this.height, 1);
    if (Math.abs(scale - this.fitScale) > 0.0001) this.fitScale = scale;
  }

  private emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /** Keeps the scene from being dragged out of the window a pane shows. */
  private clampPan(pan: { x: number; y: number }): { x: number; y: number } {
    return this.clampPanFor(this.scale, pan);
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
    const maxY = Math.max(0, (this.height * zoom - this.paneHeight) / 2);
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
    // pointer deltas are CSS pixels; pan is frame pixels while the frame is shown scaled
    const ds = this.displayScale || 1;
    this.grabbing = true;
    const move = (e: PointerEvent) => {
      this.emit('view-change', {
        pan: this.clampPan({
          x: origin.x + (e.clientX - startX) / ds,
          y: origin.y + (e.clientY - startY) / ds
        })
      });
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
      // dividers are fractions of the frame, not of the stage around it
      const rect = (this.frame ?? this.stage).getBoundingClientRect();
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

  /**
   * Label shown over a pane. The app supplies them when it can name the current pipeline
   * from a saved preset; otherwise pane 0 is simply the pipeline being edited.
   */
  private labelFor(index: number): string {
    const supplied = this.labels[index];
    if (supplied) return supplied;
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
    // pan is in frame pixels while comparing, so it scales with the frame on screen
    const ds = this.displayScale;
    const scale = this.scale * ds;
    const w = Math.round(this.width * scale);
    const h = Math.round(this.height * scale);
    const x = this.pan.x * ds;
    const y = this.pan.y * ds;
    return `width:${w}px;height:${h}px;left:calc(50% - ${w / 2}px + ${x}px);top:calc(50% - ${h / 2}px + ${y}px)`;
  }

  /** The frame itself, in CSS pixels. */
  private frameStyle(): string {
    const ds = this.displayScale;
    return `width:${Math.round(this.frameW * ds)}px;height:${Math.round(this.frameH * ds)}px`;
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
   * Downloads the comparison exactly as laid out, at the comparison frame size.
   *
   * The geometry is deliberately the same arithmetic the screen uses: each pane draws its
   * canvas scaled by `zoom`, centred in its window and offset by the shared pan. Because
   * panning is clamped against the frame rather than the browser window, the exported PNG
   * matches what is on screen regardless of how the window is sized.
   */
  async exportComposite(fileName: string): Promise<void> {
    const panes = this.visiblePanes;
    if (this.compareMode === 'off' || panes < 2) {
      this.exportPng(fileName);
      return;
    }

    const frameW = Math.max(1, Math.round(this.frameW));
    const frameH = Math.max(1, Math.round(this.frameH));
    const canvas = document.createElement('canvas');
    canvas.width = frameW;
    canvas.height = frameH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, frameW, frameH);

    const sources = this.canvases;
    const scale = this.scale;
    const drawW = this.width * scale;
    const drawH = this.height * scale;
    const top = (frameH - drawH) / 2 + this.pan.y;
    const columnW = frameW / panes;

    for (let i = 0; i < panes; i++) {
      const source = sources[i];
      if (!source) continue;

      // the band of the frame this pane owns
      const bandStart =
        this.compareMode === 'side-by-side'
          ? i * columnW
          : (i === 0 ? 0 : this.dividers[i - 1]) * frameW;
      const bandEnd =
        this.compareMode === 'side-by-side'
          ? (i + 1) * columnW
          : (i === panes - 1 ? 1 : this.dividers[i]) * frameW;
      const bandW = bandEnd - bandStart;
      if (bandW <= 0) continue;

      // side by side centres each render in its own column; overlay centres in the frame
      const left =
        this.compareMode === 'side-by-side'
          ? bandStart + (columnW - drawW) / 2 + this.pan.x
          : (frameW - drawW) / 2 + this.pan.x;

      ctx.save();
      ctx.beginPath();
      ctx.rect(bandStart, 0, bandW, frameH);
      ctx.clip();
      ctx.drawImage(source, left, top, drawW, drawH);
      ctx.restore();
    }

    if (this.exportLabels) await this.drawExportLabels(ctx, frameW, panes, columnW);

    canvas.toBlob((blob) => {
      if (blob) this.download(blob, fileName);
    }, 'image/png');
  }

  /**
   * Burns the pane labels into an exported comparison.
   *
   * `document.fonts.ready` is awaited because a canvas 2D context silently falls back to a
   * default face for a webfont that has not finished loading, which would quietly produce
   * a different image from the one on screen.
   */
  private async drawExportLabels(
    ctx: CanvasRenderingContext2D,
    frameW: number,
    panes: number,
    columnW: number
  ): Promise<void> {
    try {
      await document.fonts.ready;
    } catch {
      // fonts API unavailable: fall through and draw with whatever is resolved
    }

    const size = Math.max(11, Math.round(Math.min(frameW / panes / 14, this.frameH / 16)));
    const padX = Math.round(size * 0.5);
    const padY = Math.round(size * 0.34);
    const margin = Math.round(size * 0.8);
    ctx.font = `700 ${size}px ${LABEL_FONT}`;
    ctx.textBaseline = 'top';

    for (let i = 0; i < panes; i++) {
      const text = this.labelFor(i);
      const bandStart =
        this.compareMode === 'side-by-side'
          ? i * columnW
          : (i === 0 ? 0 : this.dividers[i - 1]) * frameW;
      const width = ctx.measureText(text).width;
      const x = bandStart + margin;
      const y = margin;

      ctx.fillStyle = LABEL_COLORS[i]?.bg ?? LABEL_COLORS[0].bg;
      ctx.fillRect(x, y, width + padX * 2, size + padY * 2);
      ctx.fillStyle = LABEL_COLORS[i]?.fg ?? LABEL_COLORS[0].fg;
      ctx.fillText(text, x + padX, y + padY);
    }
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
        ${this.renderFrameControls()}
        <span class="spacer"></span>
        <button
          class="ghost"
          ?disabled=${!this.canBenchmark}
          aria-label="Benchmark the panes"
          title=${this.canBenchmark
            ? 'Measure the GPU cost of each pane'
            : 'Needs EXT_disjoint_timer_query_webgl2, which this browser does not expose'}
          @click=${() => this.emit('benchmark-open', undefined)}
        >
          ⏱<span class="btn-label">Benchmark</span>
        </button>
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

  /**
   * Frame size and label controls. The size is what the composite PNG is written at, and
   * what the panes divide on screen, so the two cannot drift apart.
   */
  private renderFrameControls() {
    const presets = FRAME_PRESETS.map(([w, h]) => `${w}×${h}`);
    const current = `${this.frameW}×${this.frameH}`;
    return html`
      <div class="frame-pick">
        <span class="label inline">Frame</span>
        <select
          aria-label="Comparison frame size"
          title="Size of the comparison, and of the exported PNG"
          @change=${(e: Event) => this.onFramePreset((e.target as HTMLSelectElement).value)}
        >
          <option value="output" ?selected=${this.compareWidth === 0 && this.compareHeight === 0}>
            Output (${this.width}×${this.height})
          </option>
          ${FRAME_PRESETS.map(
            ([w, h], i) => html`
              <option
                value=${`${w}x${h}`}
                ?selected=${this.compareWidth === w && this.compareHeight === h}
              >
                ${presets[i]}
              </option>
            `
          )}
          ${!presets.includes(current) && this.compareWidth > 0
            ? html`<option value="custom" selected>${current}</option>`
            : nothing}
        </select>
        <input
          class="num"
          type="number"
          min="16"
          max="8192"
          step="1"
          aria-label="Comparison frame width"
          .value=${String(this.frameW)}
          @change=${(e: Event) =>
            this.onFrameSize(Number((e.target as HTMLInputElement).value), this.frameH)}
        />
        <span class="label inline">×</span>
        <input
          class="num"
          type="number"
          min="16"
          max="8192"
          step="1"
          aria-label="Comparison frame height"
          .value=${String(this.frameH)}
          @change=${(e: Event) =>
            this.onFrameSize(this.frameW, Number((e.target as HTMLInputElement).value))}
        />
        <button
          class="ghost"
          aria-pressed=${this.exportLabels}
          aria-label="Include labels in the export"
          title="Burn the pane labels into the exported PNG"
          @click=${() => this.emit('compare-change', { exportLabels: !this.exportLabels })}
        >
          🏷<span class="btn-label">Labels</span>
        </button>
      </div>
    `;
  }

  private onFramePreset(value: string): void {
    if (value === 'output') {
      this.emit('compare-change', { compareWidth: 0, compareHeight: 0 });
      return;
    }
    const [w, h] = value.split('x').map(Number);
    if (Number.isFinite(w) && Number.isFinite(h)) this.onFrameSize(w, h);
  }

  private onFrameSize(width: number, height: number): void {
    const clamp = (value: number) => Math.min(8192, Math.max(16, Math.round(value)));
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    this.emit('compare-change', { compareWidth: clamp(width), compareHeight: clamp(height) });
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
        <div class="frame" style=${comparing ? this.frameStyle() : 'width:100%;height:100%'}>
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
        ${comparing
          ? html`<span class="chip">Frame <b>${this.frameW}×${this.frameH}</b></span>`
          : nothing}
        ${comparing && this.displayScale < 0.999
          ? html`<span
              class="chip warn"
              title="The frame is larger than the window, so it is shown scaled down. The exported PNG is still exact."
              >Shown at <b>${(this.displayScale * 100).toFixed(0)}%</b></span
            >`
          : nothing}
        <span class="spacer"></span>
        <span class="chip">Render <b>${this.renderMs.toFixed(1)} ms</b></span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rsl-viewport': RslViewport;
  }
}
