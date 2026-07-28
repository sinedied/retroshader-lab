import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { panelStyles } from './shared-styles.js';
import type { CompileIssue } from '../core/types.js';
import type { PassRenderInfo } from '../core/pipeline.js';

type Tab = 'cfg' | 'passes' | 'log';

/** Right dock: live NextUI cfg, pass inspector and GLSL compile log. */
@customElement('rsl-dock')
export class RslDock extends LitElement {
  static override styles = [
    panelStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
        height: 100%;
        border-left: 1px solid var(--line);
        background: linear-gradient(180deg, var(--panel), var(--void-2));
      }

      .tabs {
        display: flex;
        flex: 0 0 auto;
        border-bottom: 1px solid var(--line);
      }

      .tabs button {
        flex: 1;
        border: 0;
        border-radius: 0;
        background: transparent;
        padding: 9px 6px;
        box-shadow: none;
        position: relative;
      }

      .tabs button + button {
        border-left: 1px solid var(--line);
      }

      .tabs button[aria-selected='true'] {
        color: var(--phosphor);
        background: rgba(125, 255, 155, 0.07);
      }

      .tabs button[aria-selected='true']::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        bottom: -1px;
        height: 1px;
        background: var(--phosphor);
        box-shadow: 0 0 12px rgba(125, 255, 155, 0.9);
      }

      .badge {
        display: inline-block;
        min-width: 15px;
        margin-left: 4px;
        padding: 0 3px;
        border-radius: 7px;
        background: var(--danger);
        color: #180402;
        font-size: 9px;
      }

      .body {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 9px;
      }

      textarea {
        width: 100%;
        min-height: 320px;
        flex: 1;
        resize: vertical;
        background: #030605;
        color: var(--phosphor);
        border: 1px solid var(--line);
        border-radius: 2px;
        font-family: var(--font-mono);
        font-size: 11.5px;
        line-height: 1.65;
        padding: 10px;
        tab-size: 2;
      }

      textarea:focus-visible {
        outline: none;
        border-color: var(--phosphor);
        box-shadow: 0 0 0 1px rgba(125, 255, 155, 0.3);
      }

      .toolbar {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .presets {
        border: 1px solid var(--line);
        border-radius: 2px;
        padding: 8px;
        background: rgba(125, 255, 155, 0.03);
      }

      .pass-card {
        border: 1px solid var(--line);
        border-radius: 2px;
        background: var(--void-2);
        overflow: hidden;
      }

      .pass-card header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 8px;
        border-bottom: 1px solid var(--line);
      }

      .pass-card header b {
        color: var(--phosphor);
        font-weight: 500;
      }

      .pass-card .thumb {
        background: #000;
        display: grid;
        place-items: center;
        padding: 6px;
      }

      .pass-card canvas {
        max-width: 100%;
        image-rendering: pixelated;
        display: block;
      }

      .pass-card footer {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        padding: 6px 8px;
        border-top: 1px solid var(--line);
      }

      .issue {
        border: 1px solid rgba(255, 107, 95, 0.35);
        border-left-width: 3px;
        border-radius: 2px;
        background: rgba(255, 107, 95, 0.05);
        padding: 7px 9px;
      }

      .issue.warn {
        border-color: rgba(255, 180, 84, 0.35);
        background: rgba(255, 180, 84, 0.05);
      }

      .issue h3 {
        margin: 0 0 4px;
        font-family: var(--font-display);
        font-variation-settings: 'wdth' 112, 'wght' 600;
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--danger);
      }

      .issue.warn h3 {
        color: var(--amber);
      }

      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 11px;
        color: var(--ink-dim);
        max-height: 260px;
        overflow: auto;
      }

      details summary {
        cursor: pointer;
        color: var(--ink-dim);
        font-size: 10.5px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        font-family: var(--font-display);
        margin-top: 6px;
      }

      .ok {
        color: var(--phosphor-dim);
        text-align: center;
        padding: 18px 8px;
        border: 1px dashed var(--line);
        border-radius: 2px;
      }
    `
  ];

  @property({ type: String }) cfgText = '';
  @property({ attribute: false }) presets: string[] = [];
  @property({ attribute: false }) passes: PassRenderInfo[] = [];
  @property({ attribute: false }) issues: CompileIssue[] = [];
  @property({ attribute: false }) warnings: string[] = [];

  @state() private tab: Tab = 'cfg';
  @state() private draft: string | undefined = undefined;
  @state() private copied = false;

  private emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /** Presets grouped as "Presets" (root cfgs) and one group per `sets/<SYSTEM>` folder. */
  private get presetGroups(): [string, string[]][] {
    const groups = new Map<string, string[]>();
    for (const path of this.presets) {
      const parts = path.split('/');
      const group =
        parts.length === 1 ? 'Presets' : parts.length === 2 ? 'Sets' : `Sets · ${parts[1]}`;
      const list = groups.get(group);
      if (list) list.push(path);
      else groups.set(group, [path]);
    }
    return [...groups.entries()];
  }

  private async copyCfg(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.draft ?? this.cfgText);
      this.copied = true;
      setTimeout(() => (this.copied = false), 1400);
    } catch {
      this.copied = false;
    }
  }

  private download(): void {
    const blob = new Blob([this.draft ?? this.cfgText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'shader.cfg';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  private importFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.cfg,text/plain';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      this.draft = text;
      this.emit('cfg-import', text);
    });
    input.click();
  }

  /** Paints a pass readback (bottom-up RGBA) into a thumbnail canvas. */
  private thumbFor(info: PassRenderInfo): HTMLCanvasElement | typeof nothing {
    if (!info.pixels) return nothing;
    const { dstw, dsth } = info.sizes;
    const canvas = document.createElement('canvas');
    const maxWidth = 320;
    const scale = Math.min(1, maxWidth / dstw);
    canvas.width = dstw;
    canvas.height = dsth;
    canvas.style.width = `${Math.round(dstw * scale)}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return nothing;
    const image = ctx.createImageData(dstw, dsth);
    const rowBytes = dstw * 4;
    for (let y = 0; y < dsth; y++) {
      const src = (dsth - 1 - y) * rowBytes;
      image.data.set(info.pixels.subarray(src, src + rowBytes), y * rowBytes);
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  private renderCfg() {
    const text = this.draft ?? this.cfgText;
    const dirty = this.draft !== undefined && this.draft !== this.cfgText;
    return html`
      ${this.presets.length > 0
        ? html`
            <div class="presets">
              <label for="preset">NextUI stock presets</label>
              <select
                id="preset"
                name="preset"
                @change=${(e: Event) => {
                  const select = e.target as HTMLSelectElement;
                  const path = select.value;
                  select.selectedIndex = 0;
                  if (path) this.emit('preset-load', path);
                }}
              >
                <option value="">— load a preset —</option>
                ${this.presetGroups.map(
                  ([group, paths]) => html`
                    <optgroup label=${group}>
                      ${paths.map(
                        (path) => html`
                          <option value=${path}>${path.split('/').pop()?.replace('.cfg', '')}</option>
                        `
                      )}
                    </optgroup>
                  `
                )}
              </select>
            </div>
          `
        : nothing}
      <div class="toolbar">
        <button class="primary" @click=${this.download}>⇩ Save .cfg</button>
        <button @click=${this.copyCfg}>${this.copied ? '✓ Copied' : '⧉ Copy'}</button>
        <button @click=${this.importFile}>⇧ Load .cfg</button>
        <button
          ?disabled=${!dirty}
          @click=${() => {
            if (this.draft !== undefined) this.emit('cfg-import', this.draft);
          }}
        >
          ▶ Apply edits
        </button>
        <button
          class="ghost"
          ?disabled=${this.draft === undefined}
          @click=${() => (this.draft = undefined)}
        >
          ↺ Revert
        </button>
      </div>
      <textarea
        id="cfg-text"
        name="cfg"
        aria-label="NextUI shader configuration"
        spellcheck="false"
        .value=${text}
        @input=${(e: Event) => (this.draft = (e.target as HTMLTextAreaElement).value)}
      ></textarea>
      <p class="hint">
        Drop this file next to your ROM as <code>&lt;rom&gt;.cfg</code>, or into
        <code>Shaders/</code> as a preset. Unknown keys from a loaded cfg (core options such as
        <code>gambatte_*</code>) are preserved.
      </p>
    `;
  }

  private renderPasses() {
    if (this.passes.length === 0) {
      return html`<p class="ok">No pass rendered — add a shader to the pipeline.</p>`;
    }
    return this.passes.map(
      (info) => html`
        <article class="pass-card">
          <header>
            <span class="idx">${String(info.index + 1).padStart(2, '0')}</span>
            <b>${info.shader}</b>
          </header>
          <div class="thumb">${this.thumbFor(info)}</div>
          <footer>
            <span class="chip">InputSize <b>${info.sizes.srcw}×${info.sizes.srch}</b></span>
            <span class="chip">TextureSize <b>${info.sizes.texw}×${info.sizes.texh}</b></span>
            <span class="chip">OutputSize <b>${info.sizes.dstw}×${info.sizes.dsth}</b></span>
          </footer>
        </article>
      `
    );
  }

  private renderLog() {
    if (this.issues.length === 0 && this.warnings.length === 0) {
      return html`<p class="ok">✓ All shaders compiled — no warnings.</p>`;
    }
    return html`
      ${this.warnings.map(
        (warning) => html`
          <div class="issue warn">
            <h3>Warning</h3>
            <pre>${warning}</pre>
          </div>
        `
      )}
      ${this.issues.map(
        (issue) => html`
          <div class="issue">
            <h3>
              ${issue.shader} · ${issue.stage}${issue.pass >= 0 ? ` · pass ${issue.pass + 1}` : ''}
            </h3>
            <pre>${issue.log || 'unknown error'}</pre>
            ${issue.source
              ? html`
                  <details>
                    <summary>Preprocessed source</summary>
                    <pre>
${issue.source
                        .split('\n')
                        .map((line, i) => `${String(i + 1).padStart(4, ' ')} │ ${line}`)
                        .join('\n')}</pre
                    >
                  </details>
                `
              : nothing}
          </div>
        `
      )}
    `;
  }

  override render() {
    const problems = this.issues.length + this.warnings.length;
    return html`
      <div class="tabs" role="tablist">
        <button
          role="tab"
          aria-selected=${this.tab === 'cfg'}
          @click=${() => (this.tab = 'cfg')}
        >
          cfg
        </button>
        <button
          role="tab"
          aria-selected=${this.tab === 'passes'}
          @click=${() => (this.tab = 'passes')}
        >
          Passes
        </button>
        <button
          role="tab"
          aria-selected=${this.tab === 'log'}
          @click=${() => (this.tab = 'log')}
        >
          Log${problems > 0 ? html`<span class="badge">${problems}</span>` : nothing}
        </button>
      </div>
      <div class="body">
        ${this.tab === 'cfg'
          ? this.renderCfg()
          : this.tab === 'passes'
            ? this.renderPasses()
            : this.renderLog()}
      </div>
    `;
  }

  override updated(changed: Map<string, unknown>): void {
    // A cfg regenerated from the UI replaces a draft that has not been edited.
    if (changed.has('cfgText') && this.draft !== undefined) {
      const previous = changed.get('cfgText') as string;
      if (this.draft === previous) this.draft = undefined;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rsl-dock': RslDock;
  }
}
