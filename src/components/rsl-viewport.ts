import { LitElement, html, css } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { panelStyles } from './shared-styles.js';
import type { Rect } from '../core/types.js';

const ZOOM_LEVELS = [0.25, 0.5, 1, 2, 3, 4, 6, 8];

/**
 * Render viewport. Owns the two WebGL canvases (main pipeline + unshaded reference)
 * and exposes them once connected so the app can drive them.
 *
 * The canvas backing store is always the output resolution, zoom is pure CSS with
 * `image-rendering: pixelated`, so a PNG export is a byte-exact 1:1 capture.
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
      }

      .bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 10px;
        border-bottom: 1px solid var(--line);
        background: linear-gradient(180deg, var(--panel-2), var(--panel));
        flex: 0 0 auto;
        flex-wrap: wrap;
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

      .stage {
        position: relative;
        flex: 1;
        min-height: 0;
        overflow: auto;
        display: grid;
        place-items: center;
        padding: 22px;
        background-color: #020403;
        background-image: linear-gradient(45deg, #0a0f0d 25%, transparent 25%),
          linear-gradient(-45deg, #0a0f0d 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #0a0f0d 75%),
          linear-gradient(-45deg, transparent 75%, #0a0f0d 75%);
        background-size: 16px 16px;
        background-position: 0 0, 0 8px, 8px -8px, -8px 0;
      }

      .frame {
        position: relative;
        line-height: 0;
        box-shadow: 0 0 0 1px var(--line-strong), 0 28px 70px -40px rgba(125, 255, 155, 0.55),
          0 0 90px -50px rgba(125, 255, 155, 0.7);
        cursor: grab;
      }

      .frame.grabbing {
        cursor: grabbing;
      }

      canvas {
        display: block;
        image-rendering: pixelated;
        background: #000;
      }

      canvas.reference {
        position: absolute;
        inset: 0;
      }

      .split-handle {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 13px;
        margin-left: -6px;
        cursor: ew-resize;
        z-index: 3;
        display: grid;
        place-items: center;
      }

      .split-handle::before {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        width: 1px;
        background: var(--amber);
        box-shadow: 0 0 12px rgba(255, 180, 84, 0.9);
      }

      .split-handle span {
        position: relative;
        font-size: 9px;
        letter-spacing: 0.1em;
        color: #1a1200;
        background: var(--amber);
        padding: 2px 3px;
        border-radius: 1px;
        font-family: var(--font-display);
        font-variation-settings: 'wdth' 112, 'wght' 700;
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
  @property({ type: String }) viewMode: 'fit' | 'zoom' = 'fit';
  @property({ type: Number }) zoom = 1;
  @property({ type: Boolean }) showSplit = false;
  @property({ type: Number }) splitPosition = 0.5;
  @property({ attribute: false }) dstRect: Rect | undefined = undefined;
  @property({ type: Number }) renderMs = 0;

  @state() private fitScale = 1;
  @state() private grabbing = false;

  @query('.stage') private stage!: HTMLDivElement;
  @query('canvas.main') private mainCanvas!: HTMLCanvasElement;
  @query('canvas.reference') private referenceCanvas!: HTMLCanvasElement;

  private resizeObserver: ResizeObserver | undefined;

  get canvases(): { main: HTMLCanvasElement; reference: HTMLCanvasElement } {
    return { main: this.mainCanvas, reference: this.referenceCanvas };
  }

  override firstUpdated(): void {
    this.resizeObserver = new ResizeObserver(() => this.updateFitScale());
    this.resizeObserver.observe(this.stage);
    requestAnimationFrame(() => this.updateFitScale());
    this.dispatchEvent(
      new CustomEvent('viewport-ready', {
        detail: this.canvases,
        bubbles: true,
        composed: true
      })
    );
  }

  override disconnectedCallback(): void {
    this.resizeObserver?.disconnect();
    super.disconnectedCallback();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('width') || changed.has('height')) this.updateFitScale();
  }

  private updateFitScale(): void {
    if (!this.stage) return;
    const padding = 44;
    const availableW = Math.max(64, this.stage.clientWidth - padding);
    const availableH = Math.max(64, this.stage.clientHeight - padding);
    this.fitScale = Math.min(availableW / this.width, availableH / this.height, 1);
  }

  private get scale(): number {
    return this.viewMode === 'fit' ? this.fitScale : this.zoom;
  }

  private emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private stepZoom(delta: number): void {
    const current = this.viewMode === 'fit' ? this.fitScale : this.zoom;
    const index = ZOOM_LEVELS.findIndex((z) => z >= current - 0.001);
    const next = ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, index + delta))];
    this.emit('view-change', { viewMode: 'zoom', zoom: next });
  }

  private onSplitDrag(event: PointerEvent): void {
    const frame = (event.currentTarget as HTMLElement).parentElement;
    if (!frame) return;
    const move = (e: PointerEvent) => {
      const rect = frame.getBoundingClientRect();
      const position = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      this.emit('view-change', { splitPosition: position });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    event.preventDefault();
  }

  private onPan(event: PointerEvent): void {
    if (event.button !== 0 || this.viewMode === 'fit') return;
    const startX = event.clientX;
    const startY = event.clientY;
    const scrollLeft = this.stage.scrollLeft;
    const scrollTop = this.stage.scrollTop;
    this.grabbing = true;
    const move = (e: PointerEvent) => {
      this.stage.scrollLeft = scrollLeft - (e.clientX - startX);
      this.stage.scrollTop = scrollTop - (e.clientY - startY);
    };
    const up = () => {
      this.grabbing = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** Downloads the render as a 1:1 PNG. */
  exportPng(fileName: string): void {
    this.mainCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, 'image/png');
  }

  override render() {
    const scale = this.scale;
    const displayW = Math.round(this.width * scale);
    const displayH = Math.round(this.height * scale);
    const rect = this.dstRect;

    return html`
      <div class="bar">
        <div class="seg">
          <button
            aria-pressed=${this.viewMode === 'fit'}
            @click=${() => this.emit('view-change', { viewMode: 'fit' })}
          >
            Fit
          </button>
          <button
            aria-pressed=${this.viewMode === 'zoom' && Math.abs(this.zoom - 1) < 0.001}
            @click=${() => this.emit('view-change', { viewMode: 'zoom', zoom: 1 })}
          >
            1:1
          </button>
        </div>

        <div class="seg">
          <button title="Zoom out" @click=${() => this.stepZoom(-1)}>−</button>
          <button
            class="zoom-readout"
            title="Reset to 1:1"
            @click=${() => this.emit('view-change', { viewMode: 'zoom', zoom: 1 })}
          >
            ${(scale * 100).toFixed(0)}%
          </button>
          <button title="Zoom in" @click=${() => this.stepZoom(1)}>+</button>
        </div>

        <button
          aria-pressed=${this.showSplit}
          class="ghost"
          title="Compare against the unshaded source"
          @click=${() => this.emit('view-change', { showSplit: !this.showSplit })}
        >
          ${this.showSplit ? '◧' : '◨'} Compare
        </button>

        <span class="spacer"></span>

        <button class="primary" @click=${() => this.emit('export-png', undefined)}>
          ⇩ Export PNG 1:1
        </button>
      </div>

      <div class="stage">
        <div
          class="frame ${this.grabbing ? 'grabbing' : ''}"
          style=${`width:${displayW}px;height:${displayH}px`}
          @pointerdown=${this.onPan}
        >
          <canvas
            class="main"
            width=${this.width}
            height=${this.height}
            style=${`width:${displayW}px;height:${displayH}px`}
          ></canvas>
          <canvas
            class="reference"
            width=${this.width}
            height=${this.height}
            style=${`width:${displayW}px;height:${displayH}px;clip-path:inset(0 0 0 ${(
              this.splitPosition * 100
            ).toFixed(3)}%);opacity:${this.showSplit ? 1 : 0};pointer-events:none`}
          ></canvas>
          ${this.showSplit
            ? html`
                <div
                  class="split-handle"
                  style=${`left:${(this.splitPosition * 100).toFixed(3)}%`}
                  @pointerdown=${this.onSplitDrag}
                >
                  <span>RAW</span>
                </div>
              `
            : ''}
        </div>
      </div>

      <div class="status">
        <span class="chip">Screen <b>${this.width}×${this.height}</b></span>
        ${rect
          ? html`<span class="chip">
              dst_rect <b>${rect.w}×${rect.h}</b> @ ${rect.x},${rect.y}
            </span>`
          : ''}
        <span class="chip">Zoom <b>${(scale * 100).toFixed(0)}%</b></span>
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
