import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { panelStyles } from './shared-styles.js';
import { FILTERS, SCALE_TYPES, UPSCALES } from '../core/types.js';
import type { PassConfig, PassSizes, ScaleTypeName, ShaderParam } from '../core/types.js';
import {
  defaultValue,
  deviceParamString,
  isConfigurable,
  stepCount,
  stepIndexOf
} from '../core/pragma-params.js';

/** Sentinel option value: not a shader name, so it cannot collide with a real one. */
const ADD_SHADER_VALUE = '\u0000add-shader';

/**
 * The shader pipeline editor: up to 3 passes, each exposing the exact NextUI options
 * (`minarch_shaderN`, `_filter`, `_srctype`, `_scaletype`, `_upscale`) plus the
 * `#pragma parameter` controls of the selected shader, quantized to NextUI's steps.
 */
@customElement('rsl-pipeline-panel')
export class RslPipelinePanel extends LitElement {
  static override styles = [
    panelStyles,
    css`
      .pass {
        border: 1px solid var(--line);
        border-radius: 2px;
        background: linear-gradient(180deg, rgba(125, 255, 155, 0.03), transparent 40%),
          var(--void-2);
      }

      .pass-head {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 6px 8px;
        border-bottom: 1px solid var(--line);
      }

      .pass-num {
        font-family: var(--font-display);
        font-variation-settings: 'wdth' 120, 'wght' 700;
        font-size: 15px;
        line-height: 1;
        color: var(--phosphor);
        text-shadow: 0 0 14px rgba(125, 255, 155, 0.5);
      }

      .pass-body {
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .icon-btn {
        padding: 3px 6px;
        font-size: 11px;
        line-height: 1;
        letter-spacing: 0;
      }

      .grid2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .sizes {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      .params {
        border-top: 1px dashed var(--line);
        padding-top: 8px;
        display: flex;
        flex-direction: column;
        gap: 7px;
      }

      .params-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .params-head .label {
        margin-bottom: 0;
      }

      .params-head button {
        padding: 3px 7px;
      }

      .param-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }

      .param-head .name {
        font-family: var(--font-display);
        font-variation-settings: 'wdth' 110, 'wght' 560;
        font-size: 10px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ink-dim);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .param-head .value {
        font-variant-numeric: tabular-nums;
        color: var(--amber);
        font-size: 11px;
        flex: 0 0 auto;
      }

      .param-key {
        color: var(--ink-faint);
        font-size: 9.5px;
      }

      .empty {
        text-align: center;
        color: var(--ink-faint);
        padding: 14px 8px;
        border: 1px dashed var(--line);
        border-radius: 2px;
        font-size: 11px;
      }

      .toolbar {
        display: flex;
        gap: 6px;
      }
    `
  ];

  @property({ attribute: false }) passes: PassConfig[] = [];
  @property({ attribute: false }) sizes: PassSizes[] = [];
  @property({ attribute: false }) shaderNames: string[] = [];
  @property({ attribute: false }) paramsByShader: Map<string, ShaderParam[]> = new Map();
  @property({ attribute: false }) collapsed: Record<string, boolean> = {};

  private emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /** True when at least one of the pass's parameters differs from its declared default. */
  private hasModifiedParams(pass: PassConfig): boolean {
    return (this.paramsByShader.get(pass.shader) ?? [])
      .filter(isConfigurable)
      .some((param) => {
        const value = pass.params[param.name];
        return value !== undefined && Math.abs(value - defaultValue(param)) > 0.0001;
      });
  }

  /**
   * Options for the source/texture type selects: the two NextUI offers, plus the pass's
   * own value when a hand-written cfg used the engine-only `viewport`, so the select
   * never claims a value the pass does not have.
   */
  private typeOptions(current: ScaleTypeName): ScaleTypeName[] {
    return SCALE_TYPES.includes(current) ? SCALE_TYPES : [...SCALE_TYPES, current];
  }

  /** Fold toggle shown in a module or pass header. */
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

  private renderParam(passIndex: number, pass: PassConfig, param: ShaderParam) {
    const count = stepCount(param);
    const value = pass.params[param.name] ?? defaultValue(param);
    const index = stepIndexOf(param, value);
    const isDefault = Math.abs(value - defaultValue(param)) < 0.0001;

    return html`
      <div>
        <div class="param-head">
          <span class="name" title=${`${param.name} — ${param.min}…${param.max} step ${param.step}`}>
            ${param.label || param.name}
          </span>
          <span class="value">${deviceParamString(param, value)}${isDefault ? '' : ' •'}</span>
        </div>
        <input
          type="range"
          id="param-${passIndex}-${param.name}"
          name=${param.name}
          aria-label=${param.label || param.name}
          min="0"
          max=${Math.max(0, count - 1)}
          step="1"
          .value=${String(index)}
          @input=${(e: Event) => {
            const step = Number((e.target as HTMLInputElement).value);
            this.emit('pass-param', {
              index: passIndex,
              name: param.name,
              value: param.min + step * param.step
            });
          }}
          @dblclick=${() =>
            this.emit('pass-param', {
              index: passIndex,
              name: param.name,
              value: defaultValue(param)
            })}
        />
        <div class="param-key">${param.name} · ${count} steps · dbl-click resets</div>
      </div>
    `;
  }

  private renderPass(pass: PassConfig, index: number) {
    const sizes = this.sizes[index];
    const params = (this.paramsByShader.get(pass.shader) ?? []).filter(isConfigurable);

    return html`
      <article class="pass">
        <div class="pass-head">
          ${this.foldButton(`pass-${index}`)}
          <span class="pass-num">${index + 1}</span>
          <select
            name="shader"
            aria-label="Shader"
            .value=${pass.shader}
            @change=${(e: Event) => {
              const select = e.target as HTMLSelectElement;
              if (select.value === ADD_SHADER_VALUE) {
                // restore the selection: the dock is where the shader actually gets added
                select.value = pass.shader;
                this.emit('shader-library-open', undefined);
                return;
              }
              this.emit('pass-change', { index, patch: { shader: select.value } });
            }}
          >
            ${this.shaderNames.map(
              (name) => html`
                <option value=${name} ?selected=${name === pass.shader}>${name}</option>
              `
            )}
            <option value=${ADD_SHADER_VALUE}>＋ Add shader…</option>
          </select>
          <button
            class="icon-btn ghost"
            title="Move up"
            ?disabled=${index === 0}
            @click=${() => this.emit('pass-move', { index, delta: -1 })}
          >
            ▲
          </button>
          <button
            class="icon-btn ghost"
            title="Move down"
            ?disabled=${index === this.passes.length - 1}
            @click=${() => this.emit('pass-move', { index, delta: 1 })}
          >
            ▼
          </button>
          <button
            class="icon-btn ghost danger"
            title="Remove pass"
            @click=${() => this.emit('pass-remove', index)}
          >
            ✕
          </button>
        </div>

        <div class="pass-body" ?hidden=${this.collapsed[`pass-${index}`]}>
          <div class="grid2">
            <div>
              <label for="filter-${index}">Filter</label>
              <select
                id="filter-${index}"
                name="filter"
                @change=${(e: Event) =>
                  this.emit('pass-change', {
                    index,
                    patch: { filter: (e.target as HTMLSelectElement).value }
                  })}
              >
                ${FILTERS.map(
                  (filter) => html`
                    <option value=${filter} ?selected=${filter === pass.filter}>${filter}</option>
                  `
                )}
              </select>
            </div>
            <div>
              <label for="upscale-${index}">Upscale</label>
              <select
                id="upscale-${index}"
                name="upscale"
                @change=${(e: Event) =>
                  this.emit('pass-change', {
                    index,
                    patch: { upscale: (e.target as HTMLSelectElement).value }
                  })}
              >
                ${UPSCALES.map(
                  (upscale) => html`
                    <option value=${upscale} ?selected=${upscale === pass.upscale}>
                      ${upscale === 'screen' ? 'screen' : `${upscale}×`}
                    </option>
                  `
                )}
              </select>
            </div>
          </div>

          <div class="grid2">
            <div>
              <label for="srctype-${index}">Source type</label>
              <select
                id="srctype-${index}"
                name="srctype"
                @change=${(e: Event) =>
                  this.emit('pass-change', {
                    index,
                    patch: { srctype: (e.target as HTMLSelectElement).value }
                  })}
              >
                ${this.typeOptions(pass.srctype).map(
                  (type) => html`
                    <option value=${type} ?selected=${type === pass.srctype}>${type}</option>
                  `
                )}
              </select>
            </div>
            <div>
              <label for="scaletype-${index}">Texture type</label>
              <select
                id="scaletype-${index}"
                name="scaletype"
                @change=${(e: Event) =>
                  this.emit('pass-change', {
                    index,
                    patch: { scaletype: (e.target as HTMLSelectElement).value }
                  })}
              >
                ${this.typeOptions(pass.scaletype).map(
                  (type) => html`
                    <option value=${type} ?selected=${type === pass.scaletype}>${type}</option>
                  `
                )}
              </select>
            </div>
          </div>

          ${sizes
            ? html`
                <div class="sizes">
                  <span class="chip">In <b>${sizes.srcw}×${sizes.srch}</b></span>
                  <span class="chip">Tex <b>${sizes.texw}×${sizes.texh}</b></span>
                  <span class="chip">Out <b>${sizes.dstw}×${sizes.dsth}</b></span>
                </div>
              `
            : nothing}
          ${params.length > 0
            ? html`
                <div class="params">
                  <div class="params-head">
                    <span class="label">Parameters</span>
                    <button
                      class="ghost"
                      ?disabled=${!this.hasModifiedParams(pass)}
                      title="Reset every parameter of this pass to the shader's default"
                      @click=${() => this.emit('pass-params-reset', index)}
                    >
                      ↺<span class="btn-label">Reset</span>
                    </button>
                  </div>
                  ${params.map((param) => this.renderParam(index, pass, param))}
                </div>
              `
            : nothing}
        </div>
      </article>
    `;
  }

  override render() {
    return html`
      <section class="module">
        <div class="module-head">
          ${this.foldButton('pipeline')}
          <span class="idx">03</span>
          <h2>Pipeline</h2>
          <span class="spacer"></span>
          <span class="chip">
            <span class="clip">minarch_nrofshaders</span>
            <b>${this.passes.length === 0 ? 'off' : this.passes.length}</b>
          </span>
        </div>
        <div class="module-body" ?hidden=${this.collapsed['pipeline']}>
          ${this.passes.length === 0
            ? html`<p class="empty">No shader pass — the source is scaled straight to the screen.</p>`
            : this.passes.map((pass, index) => this.renderPass(pass, index))}

          <div class="toolbar">
            <button
              class="primary"
              ?disabled=${this.passes.length >= 3}
              @click=${() => this.emit('pass-add', undefined)}
            >
              + Add pass
            </button>
          </div>
          <p class="hint">
            Pass <b>N</b> renders into a texture created with pass <b>N+1</b>'s filter, exactly like
            <code>runShaderPass()</code>. <b>screen</b> upscale renders straight at the destination
            rect size.
          </p>
        </div>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rsl-pipeline-panel': RslPipelinePanel;
  }
}
