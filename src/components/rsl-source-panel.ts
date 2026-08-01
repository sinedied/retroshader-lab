import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { panelStyles } from './shared-styles.js';
import {
  PATTERN_KINDS,
  SYSTEM_RESOLUTIONS,
  type PatternKind,
  type SystemResolution
} from '../core/test-patterns.js';
import { OUTPUT_PRESETS, CORE_ASPECTS } from '../core/scaling.js';
import type { GbPaletteGroup } from '../core/gb-palettes.js';
import { SCALING_MODES, FILTERS } from '../core/types.js';
import type { FilterName, ScalingMode, SourceImage } from '../core/types.js';
import type { SampleEntry } from '../core/shader-library.js';

/** Source image selection + output/screen-scaling settings (NextUI frontend options). */
@customElement('rsl-source-panel')
export class RslSourcePanel extends LitElement {
  static override styles = [
    panelStyles,
    css`
      .preview {
        display: flex;
        gap: 10px;
        align-items: center;
        min-width: 0;
      }

      .thumb {
        width: 92px;
        height: 74px;
        flex: 0 0 auto;
        border: 1px solid var(--line);
        border-radius: 2px;
        background-color: #000;
        background-image: linear-gradient(45deg, #0d1210 25%, transparent 25%),
          linear-gradient(-45deg, #0d1210 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #0d1210 75%),
          linear-gradient(-45deg, transparent 75%, #0d1210 75%);
        background-size: 8px 8px;
        background-position: 0 0, 0 4px, 4px -4px, -4px 0;
        display: grid;
        place-items: center;
        overflow: hidden;
      }

      .thumb img,
      .thumb canvas {
        max-width: 100%;
        max-height: 100%;
        image-rendering: pixelated;
      }

      .meta {
        display: flex;
        flex-direction: column;
        gap: 5px;
        min-width: 0;
        flex: 1 1 auto;
      }

      .drop {
        border: 1px dashed var(--line-strong);
        border-radius: 2px;
        padding: 9px;
        text-align: center;
        color: var(--ink-dim);
        font-size: 10.5px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        font-family: var(--font-display);
        cursor: pointer;
        transition: color 0.15s, border-color 0.15s, background 0.15s;
      }

      .drop:hover,
      .drop.over {
        color: var(--phosphor);
        border-color: var(--phosphor);
        background: rgba(125, 255, 155, 0.06);
      }

      .grid2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      /* the group label is short, the palette names are long, so give them the room */
      .palette {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
        gap: 8px;
        margin-top: 8px;
      }
    `
  ];

  @property({ attribute: false }) source: SourceImage | undefined = undefined;
  @property({ type: String }) system = 'gb';
  @property({ type: String }) pattern: PatternKind = 'grid';
  @property({ type: String }) sampleFile: string | undefined = undefined;
  @property({ attribute: false }) samples: SampleEntry[] = [];
  @property({ type: String }) uploadedName: string | undefined = undefined;
  @property({ type: Number }) outputWidth = 1024;
  @property({ type: Number }) outputHeight = 768;
  @property({ type: String }) scaling: ScalingMode = 'Aspect';
  @property({ type: String }) scaleFilter: FilterName = 'NEAREST';
  @property({ type: Number }) coreAspect = 4 / 3;
  @property({ attribute: false }) collapsed: Record<string, boolean> = {};
  @property({ type: String }) gbPalette = '';
  @property({ attribute: false }) paletteGroups: GbPaletteGroup[] = [];
  /** Whether the selected screenshot is a Game Boy one, the only kind that recolours. */
  @property({ type: Boolean }) isGbSample = false;

  @state() private dragOver = false;

  /** Screenshots grouped into `<optgroup>`s, in the platform order of the manifest. */
  private get samplesByPlatform(): [string, SampleEntry[]][] {
    const groups = new Map<string, SampleEntry[]>();
    for (const entry of this.samples) {
      const key = entry.platform ?? 'Other';
      const list = groups.get(key);
      if (list) list.push(entry);
      else groups.set(key, [entry]);
    }
    return [...groups.entries()];
  }

  private emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /** Fold toggle shown in a module header. */
  private foldButton(id: string) {
    const open = !this.collapsed[id];
    return html`
      <button
        class="fold"
        aria-expanded=${open}
        aria-label=${open ? 'Collapse panel' : 'Expand panel'}
        title=${open ? 'Collapse' : 'Expand'}
        @click=${() => this.emit('toggle-panel', id)}
      >
        ▼
      </button>
    `;
  }

  private onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) this.emit('source-file', file);
  }

  private onPick(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) this.emit('source-file', file);
    });
    input.click();
  }

  /**
   * Palette controls, shown only for a Game Boy screenshot.
   *
   * Two selects rather than one: the table holds 581 palettes, and TWB64 alone is 300, so a
   * single list would be unusable. The group is derived from the selected palette rather
   * than held separately, so the pair cannot drift out of step with the saved state.
   */
  private renderPalettePicker() {
    if (!this.isGbSample || this.paletteGroups.length === 0) return nothing;
    const group =
      this.paletteGroups.find((g) => g.palettes.some((p) => p.name === this.gbPalette)) ??
      this.paletteGroups[0];

    return html`
      <div class="palette">
        <div>
          <label for="pal-group">Group</label>
          <select
            id="pal-group"
            name="palette-group"
            @change=${(e: Event) => {
              const next = this.paletteGroups.find(
                (g) => g.group === (e.target as HTMLSelectElement).value
              );
              // moving group picks its first palette, so the selection is always valid
              if (next?.palettes[0]) this.emit('gb-palette', next.palettes[0].name);
            }}
          >
            ${this.paletteGroups.map(
              (entry) => html`
                <option value=${entry.group} ?selected=${entry.group === group.group}>
                  ${entry.group} · ${entry.palettes.length}
                </option>
              `
            )}
          </select>
        </div>
        <div>
          <label for="pal">Palette</label>
          <select
            id="pal"
            name="palette"
            @change=${(e: Event) => this.emit('gb-palette', (e.target as HTMLSelectElement).value)}
          >
            ${group.palettes.map(
              (palette) => html`
                <option value=${palette.name} ?selected=${palette.name === this.gbPalette}>
                  ${palette.name}
                </option>
              `
            )}
          </select>
        </div>
      </div>
    `;
  }

  private renderThumb() {
    const bitmap = this.source?.bitmap;
    if (!bitmap) return nothing;
    if (bitmap instanceof HTMLCanvasElement) {
      const clone = document.createElement('canvas');
      clone.width = bitmap.width;
      clone.height = bitmap.height;
      clone.getContext('2d')?.drawImage(bitmap, 0, 0);
      return clone;
    }
    if (bitmap instanceof HTMLImageElement) {
      const img = new Image();
      img.src = bitmap.src;
      return img;
    }
    return nothing;
  }

  override render() {
    const presetMatch = OUTPUT_PRESETS.find(
      (preset) => preset.width === this.outputWidth && preset.height === this.outputHeight
    );

    return html`
      <section class="module">
        <div class="module-head">
          ${this.foldButton('source')}
          <span class="idx">01</span>
          <h2>Source</h2>
          <span class="spacer"></span>
          <span class="chip">
            <b>${this.source?.width ?? 0}×${this.source?.height ?? 0}</b>
          </span>
        </div>
        <div class="module-body" ?hidden=${this.collapsed['source']}>
          ${this.samples.length > 0
            ? html`
                <div>
                  <label for="sample">Game screenshots</label>
                  <select
                    id="sample"
                    name="sample"
                    @change=${(e: Event) =>
                      this.emit('source-sample', (e.target as HTMLSelectElement).value)}
                  >
                    <option value="" ?selected=${!this.sampleFile}>— generated pattern —</option>
                    ${this.samplesByPlatform.map(
                      ([platform, entries]) => html`
                        <optgroup label=${platform}>
                          ${entries.map(
                            (entry) => html`
                              <option value=${entry.file} ?selected=${entry.file === this.sampleFile}>
                                ${entry.title}${entry.width
                                  ? ` · ${entry.width}×${entry.height}`
                                  : ''}
                              </option>
                            `
                          )}
                        </optgroup>
                      `
                    )}
                  </select>
                </div>
              `
            : nothing}
          ${this.renderPalettePicker()}

          <div class="preview">
            <div class="thumb">${this.renderThumb()}</div>
            <div class="meta">
              <div>
                <label for="sys">System resolution</label>
                <select
                  id="sys" name="system"
                  .value=${this.system}
                  @change=${(e: Event) =>
                    this.emit('source-system', (e.target as HTMLSelectElement).value)}
                >
                  ${SYSTEM_RESOLUTIONS.map(
                    (sys: SystemResolution) => html`
                      <option value=${sys.id} ?selected=${sys.id === this.system}>
                        ${sys.label} · ${sys.width}×${sys.height}
                      </option>
                    `
                  )}
                </select>
              </div>
              <div>
                <label for="pat">Test pattern</label>
                <select
                  id="pat" name="pattern"
                  .value=${this.pattern}
                  @change=${(e: Event) =>
                    this.emit('source-pattern', (e.target as HTMLSelectElement).value)}
                >
                  ${PATTERN_KINDS.map(
                    (kind) => html`
                      <option value=${kind.id} ?selected=${kind.id === this.pattern}>
                        ${kind.label}
                      </option>
                    `
                  )}
                </select>
              </div>
            </div>
          </div>

          <div
            class="drop ${this.dragOver ? 'over' : ''}"
            @click=${this.onPick}
            @dragover=${(e: DragEvent) => {
              e.preventDefault();
              this.dragOver = true;
            }}
            @dragleave=${() => (this.dragOver = false)}
            @drop=${this.onDrop}
          >
            ${this.uploadedName ? `▣ ${this.uploadedName}` : 'Drop a screenshot · or click to browse'}
          </div>

        </div>
      </section>

      <section class="module">
        <div class="module-head">
          ${this.foldButton('output')}
          <span class="idx">02</span>
          <h2>Output</h2>
          <span class="spacer"></span>
          <span class="chip"><b>${this.outputWidth}×${this.outputHeight}</b></span>
        </div>
        <div class="module-body" ?hidden=${this.collapsed['output']}>
          <div>
            <label for="res">Screen resolution</label>
            <select
              id="res" name="resolution"
              @change=${(e: Event) => {
                const value = (e.target as HTMLSelectElement).value;
                if (value === 'custom') return;
                const [w, h] = value.split('x').map(Number);
                this.emit('output-size', { width: w, height: h });
              }}
            >
              ${OUTPUT_PRESETS.map(
                (preset) => html`
                  <option
                    value=${`${preset.width}x${preset.height}`}
                    ?selected=${preset === presetMatch}
                  >
                    ${preset.label}
                  </option>
                `
              )}
              <option value="custom" ?selected=${!presetMatch}>Custom</option>
            </select>
          </div>

          <div class="grid2">
            <div>
              <label for="ow">Width</label>
              <input
                id="ow" name="output-width"
                type="number"
                min="64"
                max="4096"
                step="1"
                .value=${String(this.outputWidth)}
                @change=${(e: Event) =>
                  this.emit('output-size', {
                    width: Number((e.target as HTMLInputElement).value),
                    height: this.outputHeight
                  })}
              />
            </div>
            <div>
              <label for="oh">Height</label>
              <input
                id="oh" name="output-height"
                type="number"
                min="64"
                max="4096"
                step="1"
                .value=${String(this.outputHeight)}
                @change=${(e: Event) =>
                  this.emit('output-size', {
                    width: this.outputWidth,
                    height: Number((e.target as HTMLInputElement).value)
                  })}
              />
            </div>
          </div>

          <div class="grid2">
            <div>
              <label for="scaling" title="minarch_screen_scaling">Screen scaling</label>
              <select
                id="scaling"
                name="scaling"
                @change=${(e: Event) =>
                  this.emit('scaling', (e.target as HTMLSelectElement).value)}
              >
                ${SCALING_MODES.map(
                  (mode) => html`
                    <option value=${mode} ?selected=${mode === this.scaling}>${mode}</option>
                  `
                )}
              </select>
            </div>
            <div>
              <label for="sfilter" title="minarch_scale_filter">Scale filter</label>
              <select
                id="sfilter"
                name="scale-filter"
                @change=${(e: Event) =>
                  this.emit('scale-filter', (e.target as HTMLSelectElement).value)}
              >
                ${FILTERS.map(
                  (filter) => html`
                    <option value=${filter} ?selected=${filter === this.scaleFilter}>
                      ${filter}
                    </option>
                  `
                )}
              </select>
            </div>
          </div>

          ${this.scaling === 'Aspect'
            ? html`
                <div>
                  <label for="aspect">Core aspect ratio</label>
                  <select
                    id="aspect"
                    name="core-aspect"
                    @change=${(e: Event) =>
                      this.emit('core-aspect', Number((e.target as HTMLSelectElement).value))}
                  >
                    ${CORE_ASPECTS.map(
                      (aspect) => html`
                        <option
                          value=${aspect.value}
                          ?selected=${Math.abs(aspect.value - this.coreAspect) < 0.001}
                        >
                          ${aspect.label}
                        </option>
                      `
                    )}
                  </select>
                </div>
              `
            : nothing}
          <p class="hint">
            The destination rect is computed exactly like NextUI:
            <b>Native</b>/<b>Cropped</b> use an integer scale, <b>Aspect</b> fits the core ratio,
            <b>Fullscreen</b> stretches.
          </p>
        </div>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rsl-source-panel': RslSourcePanel;
  }
}
