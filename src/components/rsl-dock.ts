import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { panelStyles } from './shared-styles.js';
import type { CompileIssue } from '../core/types.js';
import type { PassRenderInfo } from '../core/pipeline.js';
import type { UserPreset } from '../core/user-presets.js';
import type { SelectedPreset } from '../core/state.js';
import type { ShaderEntry } from '../core/shader-library.js';
import { groupPresets, type PresetEntry } from '../core/preset-config.js';

type Tab = 'cfg' | 'passes' | 'shaders' | 'log';

/** Right dock: live NextUI cfg, pass inspector, shader library and GLSL compile log. */
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

      .preset-actions {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-top: 7px;
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

      .drop {
        border: 1px dashed var(--line-strong);
        border-radius: var(--radius);
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 12px;
      }

      .drop.over {
        border-color: var(--phosphor);
        background: rgba(125, 255, 155, 0.06);
      }

      .drop .hint {
        margin: 0;
      }

      .file input {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
      }

      .file {
        display: inline-block;
        margin: 0;
      }

      .file .btn {
        display: inline-block;
        cursor: pointer;
        font-family: var(--font-display);
        font-size: 10px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--ink);
        background: var(--panel-3);
        border: 1px solid var(--line-strong);
        border-radius: 2px;
        padding: 6px 10px;
      }

      .file .btn:hover {
        border-color: var(--phosphor-dim);
        color: var(--phosphor);
      }

      h3.section {
        margin: 14px 0 6px;
      }

      .shader-notice {
        margin: 0;
        font-size: 11px;
        line-height: 1.45;
        overflow-wrap: anywhere;
      }

      .shader-notice.ok {
        color: var(--phosphor);
      }

      .shader-notice.bad {
        color: var(--amber);
      }

      .shader-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .shader-list li {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 6px;
        border: 1px solid transparent;
        border-radius: 2px;
        background: rgba(0, 0, 0, 0.25);
      }

      .shader-list .name {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
        font-size: 11.5px;
      }

      .shader-list .meta {
        color: var(--ink-faint);
        font-size: 10px;
        white-space: nowrap;
      }

      .shader-list.muted li {
        background: none;
        color: var(--ink-dim);
      }

      .shader-list button {
        padding: 2px 7px;
      }

      .issue {        border: 1px solid rgba(255, 107, 95, 0.35);
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
  @property({ attribute: false }) userPresets: UserPreset[] = [];
  @property({ attribute: false }) selectedPreset: SelectedPreset | undefined = undefined;
  @property({ attribute: false }) passes: PassRenderInfo[] = [];
  @property({ attribute: false }) issues: CompileIssue[] = [];
  @property({ attribute: false }) warnings: string[] = [];
  /** Every shader in the library, bundled and custom. */
  @property({ attribute: false }) shaders: ShaderEntry[] = [];
  /** Shader names the current pipeline uses, which therefore cannot be deleted. */
  @property({ attribute: false }) shadersInUse: string[] = [];
  /** Result of the last add or delete, shown next to the controls that caused it. */
  @property({ attribute: false }) shaderNotice: { ok: boolean; text: string } | undefined =
    undefined;

  @state() private tab: Tab = 'cfg';
  @state() private draft: string | undefined = undefined;
  @state() private copied = false;
  @state() private shaderUrl = '';
  @state() private dropping = false;

  private emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /** Stock presets grouped by folder; HTML forbids nested optgroups, so the labels
      carry the hierarchy instead. */
  private get presetGroups(): [string, PresetEntry[]][] {
    return groupPresets(this.presets);
  }

  /** The selected user preset, when the selection points at one. */
  private get selectedUserPreset(): UserPreset | undefined {
    if (this.selectedPreset?.kind !== 'user') return undefined;
    return this.userPresets.find((preset) => preset.id === this.selectedPreset?.id);
  }

  /** True when the pipeline no longer matches the preset that is selected. */
  private get presetModified(): boolean {
    const preset = this.selectedUserPreset;
    if (!preset) return false;
    return preset.cfg.trim() !== this.cfgText.trim();
  }

  private get selectValue(): string {
    if (!this.selectedPreset) return '';
    return this.selectedPreset.kind === 'user'
      ? `user:${this.selectedPreset.id}`
      : `stock:${this.selectedPreset.id}`;
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

  /**
   * Paints a pass readback into a thumbnail canvas.
   *
   * No row flip: `readPixels` hands back rows bottom-up, but the pipeline deliberately
   * renders intermediate passes upside down (the NextUI Y quirk, undone by
   * `default.glsl` at the very end), so the two cancel out and the buffer is already in
   * display order. Flipping here is what made the thumbnails appear inverted.
   */
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
    image.data.set(info.pixels.subarray(0, dstw * dsth * 4));
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  private renderCfg() {
    const text = this.draft ?? this.cfgText;
    const dirty = this.draft !== undefined && this.draft !== this.cfgText;
    return html`
      <div class="presets">
        <label for="preset">Presets</label>
        <select
          id="preset"
          name="preset"
          .value=${this.selectValue}
          @change=${(e: Event) => {
            const value = (e.target as HTMLSelectElement).value;
            if (!value) return;
            const [kind, ...rest] = value.split(':');
            this.emit('preset-load', { kind, id: rest.join(':') });
          }}
        >
          <option value="" ?selected=${!this.selectedPreset}>— load a preset —</option>
          ${this.userPresets.length > 0
            ? html`
                <optgroup label="Your presets">
                  ${this.userPresets.map(
                    (preset) => html`
                      <option
                        value=${`user:${preset.id}`}
                        ?selected=${this.selectedPreset?.kind === 'user' &&
                        this.selectedPreset.id === preset.id}
                      >
                        ${preset.name}${this.presetModified &&
                        this.selectedPreset?.id === preset.id
                          ? ' •'
                          : ''}
                      </option>
                    `
                  )}
                </optgroup>
              `
            : nothing}
          ${this.presetGroups.map(
            ([group, entries]) => html`
              <optgroup label=${group}>
                ${entries.map(
                  (entry) => html`
                    <option
                      value=${`stock:${entry.path}`}
                      ?selected=${this.selectedPreset?.kind === 'stock' &&
                      this.selectedPreset.id === entry.path}
                    >
                      ${entry.label}
                    </option>
                  `
                )}
              </optgroup>
            `
          )}
        </select>

        <div class="preset-actions">
          <button
            title="Save the current pipeline as a user preset"
            @click=${() => this.emit('preset-save', undefined)}
          >
            ＋ Save preset
          </button>
          ${this.selectedUserPreset
            ? html`
                <button
                  ?disabled=${!this.presetModified}
                  title="Overwrite this preset with the current pipeline"
                  @click=${() => this.emit('preset-update', this.selectedUserPreset?.id)}
                >
                  ⟳ Update
                </button>
                <button
                  title="Rename this preset"
                  @click=${() => this.emit('preset-rename', this.selectedUserPreset?.id)}
                >
                  ✎ Rename
                </button>
                <button
                  class="danger"
                  title="Delete this preset"
                  @click=${() => this.emit('preset-delete', this.selectedUserPreset?.id)}
                >
                  ✕ Delete
                </button>
              `
            : nothing}
        </div>
      </div>
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

  private renderShaders() {
    const custom = this.shaders.filter((entry) => entry.custom);
    const bundled = this.shaders.filter((entry) => !entry.custom);
    const inUse = new Set(this.shadersInUse);

    return html`
      <div
        class="drop ${this.dropping ? 'over' : ''}"
        @dragover=${(e: DragEvent) => {
          e.preventDefault();
          this.dropping = true;
        }}
        @dragleave=${() => (this.dropping = false)}
        @drop=${(e: DragEvent) => {
          e.preventDefault();
          this.dropping = false;
          const files = [...(e.dataTransfer?.files ?? [])];
          if (files.length > 0) this.emit('shader-add-file', files);
        }}
      >
        <p class="hint">Drop a <code>.glsl</code> here, or</p>
        <div class="row">
          <label class="file">
            <input
              type="file"
              accept=".glsl,.frag,.fs,.vert,.txt,text/plain"
              multiple
              @change=${(e: Event) => {
                const input = e.target as HTMLInputElement;
                const files = [...(input.files ?? [])];
                if (files.length > 0) this.emit('shader-add-file', files);
                // let the same file be picked again after a failure
                input.value = '';
              }}
            />
            <span class="btn">Choose file…</span>
          </label>
        </div>
        <div class="row">
          <input
            type="url"
            placeholder="https://raw.githubusercontent.com/…/shader.glsl"
            .value=${this.shaderUrl}
            @input=${(e: Event) => (this.shaderUrl = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter') this.submitUrl();
            }}
          />
          <button
            class="primary"
            ?disabled=${this.shaderUrl.trim().length === 0}
            @click=${() => this.submitUrl()}
          >
            Fetch
          </button>
        </div>
        <p class="hint">
          A URL only works if the server allows cross-origin reads. Raw GitHub links and CDNs
          do; most plain web servers do not — download the file and add it from disk instead.
        </p>
        ${this.shaderNotice
          ? html`<p class="shader-notice ${this.shaderNotice.ok ? 'ok' : 'bad'}">
              ${this.shaderNotice.ok ? '✓' : '⚠'} ${this.shaderNotice.text}
            </p>`
          : nothing}
      </div>

      <h3 class="label section">Your shaders (${custom.length})</h3>
      ${custom.length === 0
        ? html`<p class="hint">None yet. Anything you add appears here and is kept in this browser.</p>`
        : html`
            <ul class="shader-list">
              ${custom.map(
                (entry) => html`
                  <li>
                    <span class="name">${entry.name}</span>
                    <span class="meta"
                      >${entry.params.length} param${entry.params.length === 1 ? '' : 's'}</span
                    >
                    <button
                      class="ghost"
                      ?disabled=${inUse.has(entry.name)}
                      title=${inUse.has(entry.name)
                        ? 'In use by the current pipeline — remove the pass first'
                        : `Delete ${entry.name}`}
                      aria-label=${`Delete ${entry.name}`}
                      @click=${() => this.emit('shader-delete', entry.name)}
                    >
                      ✕
                    </button>
                  </li>
                `
              )}
            </ul>
          `}

      <h3 class="label section">Bundled from NextUI (${bundled.length})</h3>
      <ul class="shader-list muted">
        ${bundled.map(
          (entry) => html`
            <li>
              <span class="name">${entry.name}</span>
              <span class="meta"
                >${entry.params.length} param${entry.params.length === 1 ? '' : 's'}</span
              >
            </li>
          `
        )}
      </ul>
    `;
  }

  private submitUrl(): void {
    const url = this.shaderUrl.trim();
    if (url.length === 0) return;
    this.emit('shader-add-url', url);
    this.shaderUrl = '';
  }

  /** Brings the shader library into view, for the pass editor's quick-add. */
  showShaders(): void {
    this.tab = 'shaders';
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
          aria-selected=${this.tab === 'shaders'}
          @click=${() => (this.tab = 'shaders')}
        >
          Shaders
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
            : this.tab === 'shaders'
              ? this.renderShaders()
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
