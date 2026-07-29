import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { panelStyles } from './shared-styles.js';
import type { BenchmarkResult } from '../core/benchmark.js';

/**
 * Benchmark results, in a native `<dialog>` so focus trapping, the backdrop and Escape
 * come from the platform rather than being reimplemented.
 */
@customElement('rsl-benchmark')
export class RslBenchmark extends LitElement {
  static override styles = [
    panelStyles,
    css`
      dialog {
        border: 1px solid var(--line-strong);
        border-radius: var(--radius);
        background: linear-gradient(180deg, var(--panel-2), var(--panel));
        color: var(--ink);
        padding: 0;
        min-width: min(620px, 92vw);
        max-width: 92vw;
        box-shadow: 0 40px 90px -40px #000, 0 0 0 1px rgba(125, 255, 155, 0.1);
      }

      dialog::backdrop {
        background: rgba(2, 4, 3, 0.72);
        backdrop-filter: blur(2px);
      }

      header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--line);
      }

      header h2 {
        margin: 0;
        font-family: var(--font-display);
        font-variation-settings: 'wdth' 118, 'wght' 620;
        font-size: 12px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      .body {
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-variant-numeric: tabular-nums;
      }

      th {
        text-align: left;
        font-family: var(--font-display);
        font-variation-settings: 'wdth' 112, 'wght' 560;
        font-size: 9.5px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-dim);
        padding: 0 8px 6px 0;
        border-bottom: 1px solid var(--line);
        white-space: nowrap;
      }

      td {
        padding: 7px 8px 7px 0;
        border-bottom: 1px solid rgba(125, 255, 155, 0.06);
        font-size: 12px;
        vertical-align: baseline;
      }

      th.num,
      td.num {
        text-align: right;
      }

      .name {
        color: var(--ink);
      }

      .name small {
        display: block;
        color: var(--ink-faint);
        font-size: 10px;
        margin-top: 2px;
      }

      .reference .pct {
        color: var(--phosphor);
      }

      .faster .pct {
        color: var(--phosphor);
      }

      .slower .pct {
        color: var(--amber);
      }

      .pct {
        font-size: 13px;
      }

      .dev {
        color: var(--ink-faint);
        font-size: 10.5px;
      }

      .flag {
        color: var(--amber);
        cursor: help;
      }

      progress {
        width: 100%;
        height: 4px;
        appearance: none;
      }

      progress::-webkit-progress-bar {
        background: rgba(0, 0, 0, 0.5);
      }

      progress::-webkit-progress-value {
        background: var(--phosphor);
      }

      .foot {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .foot .spacer {
        flex: 1;
      }
    `
  ];

  @property({ attribute: false }) results: BenchmarkResult[] = [];
  @property({ type: Boolean }) running = false;
  @property({ type: Number }) progress = 0;
  @property({ type: String }) note = '';

  @query('dialog') private dialog!: HTMLDialogElement;

  show(): void {
    if (!this.dialog.open) this.dialog.showModal();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  private emit(type: string): void {
    this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true }));
  }

  private renderRow(result: BenchmarkResult, index: number) {
    const reference = index === 0;
    const slower = !reference && result.percent < 99.5;
    const faster = !reference && result.percent > 100.5;
    const shaders = result.shaders.length > 0 ? result.shaders.join(' → ') : 'no shader';

    return html`
      <tr class=${reference ? 'reference' : faster ? 'faster' : slower ? 'slower' : ''}>
        <td class="name">
          ${result.label}
          <small>${result.shaders.length} pass${result.shaders.length === 1 ? '' : 'es'} · ${shaders}</small>
        </td>
        <td class="num">
          ${Number.isFinite(result.mean) ? result.mean.toFixed(3) : '—'}
          <div class="dev">
            ± ${result.deviation.toFixed(3)}
            ${result.noisy ? html`<span class="flag" title="High variance — close other GPU-heavy tabs and run again">⚠</span>` : nothing}
          </div>
        </td>
        <td class="num dev">
          ${Number.isFinite(result.min) ? `${result.min.toFixed(3)}–${result.max.toFixed(3)}` : '—'}
        </td>
        <td class="num pct">
          ${Number.isFinite(result.percent) ? `${result.percent.toFixed(0)}%` : '—'}
        </td>
      </tr>
    `;
  }

  override render() {
    const noisy = this.results.some((result) => result.noisy);

    return html`
      <dialog @close=${() => this.emit('benchmark-close')}>
        <header>
          <h2>Benchmark</h2>
          <span class="spacer" style="flex:1"></span>
          <button class="ghost" aria-label="Close" @click=${() => this.close()}>✕</button>
        </header>
        <div class="body">
          ${this.running
            ? html`
                <p class="hint">Measuring GPU time…</p>
                <progress value=${this.progress} max="1"></progress>
              `
            : nothing}
          ${this.results.length > 0
            ? html`
                <table>
                  <thead>
                    <tr>
                      <th>Pipeline</th>
                      <th class="num">GPU ms</th>
                      <th class="num">Range</th>
                      <th class="num">Perf.</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${this.results.map((result, index) => this.renderRow(result, index))}
                  </tbody>
                </table>
                <p class="hint">
                  GPU time per frame at ${this.note}, measured with timer queries and averaged over
                  ${this.results[0]?.samples ?? 0} runs after warmup. <b>Perf.</b> is relative to the
                  current pipeline, so half the speed reads 50%. These numbers rank pipelines against
                  each other on <em>this</em> GPU; they are not a prediction of handheld performance.
                  ${noisy
                    ? html`<br /><span class="flag">⚠ One or more results varied too much to trust — close other GPU-heavy tabs and run again.</span>`
                    : nothing}
                </p>
              `
            : this.running
              ? nothing
              : html`<p class="hint">No results yet.</p>`}
          <div class="foot">
            <button
              class="primary"
              ?disabled=${this.running}
              @click=${() => this.emit('benchmark-rerun')}
            >
              ↻ Run again
            </button>
            <span class="spacer"></span>
            <button @click=${() => this.close()}>Close</button>
          </div>
        </div>
      </dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rsl-benchmark': RslBenchmark;
  }
}
