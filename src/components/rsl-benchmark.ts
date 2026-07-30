import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { panelStyles } from './shared-styles.js';
import {
  NOISE_THRESHOLD,
  ROUND_PRESETS,
  type BenchmarkQuality,
  type BenchmarkResult
} from '../core/benchmark.js';

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
        /* an explicit width: without one the dialog shrink-to-fits the longest line of
           prose, which on a wide screen stretched it into a 1800px banner */
        width: min(760px, 92vw);
        max-width: 92vw;
        max-height: 86vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 40px 90px -40px #000, 0 0 0 1px rgba(125, 255, 155, 0.1);
      }

      dialog:not([open]) {
        display: none;
      }

      dialog::backdrop {
        /* translucent, but deliberately no backdrop-filter: the canvases keep rendering
           underneath during a run, and a blur of them would be recomputed every frame,
           competing with the very thing being measured. Plain alpha compositing is cheap
           enough not to matter. */
        background: rgba(2, 4, 3, 0.55);
      }

      header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--line);
        flex: none;
      }

      .spacer {
        flex: 1;
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
        overflow-y: auto;
        min-height: 0;
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
        padding: 10px 12px;
        border-top: 1px solid var(--line);
        flex: none;
      }

      .quality {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--ink-dim);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        font-family: var(--font-display);
      }
    `
  ];

  @property({ attribute: false }) results: BenchmarkResult[] = [];
  @property({ type: Boolean }) running = false;
  @property({ type: Number }) progress = 0;
  @property({ type: String }) quality: BenchmarkQuality = 'standard';
  @property({ type: String }) note = '';

  @state() private copied: 'idle' | 'ok' | 'fail' = 'idle';

  @query('dialog') private dialog!: HTMLDialogElement;

  show(): void {
    if (!this.dialog.open) this.dialog.showModal();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  private emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /** The pass count and shader chain, shared so the table and the markdown cannot drift. */
  private static passSummary(result: BenchmarkResult): string {
    const chain = result.shaders.length > 0 ? result.shaders.join(' → ') : 'no shader';
    return `${result.shaders.length} pass${result.shaders.length === 1 ? '' : 'es'} · ${chain}`;
  }

  /**
   * The results as a markdown table of pipeline against relative performance. Perf. is
   * the figure worth sharing: the absolute milliseconds only mean anything on the GPU
   * that produced them.
   */
  private markdownTable(): string {
    const rows = this.results.map((result) => [
      // the label alone is just a preset name; the pass chain is what actually identifies
      // what was measured, and it is what the dialog shows under the name. A label is
      // user-supplied, and a bare pipe in one would split the cell.
      `${result.label} · ${RslBenchmark.passSummary(result)}`.replace(/\|/g, '\\|'),
      Number.isFinite(result.percent) ? `${result.percent.toFixed(0)}%` : '—'
    ]);
    const header = ['Pipeline', 'Perf.'];
    // padded so the raw text stays readable, not only the rendered table
    const width = [header, ...rows].reduce(
      (widest, row) => row.map((cell, i) => Math.max(widest[i] ?? 0, [...cell].length)),
      [0, 0]
    );
    const line = (cells: string[]) =>
      `| ${cells.map((cell, i) => cell.padEnd(width[i])).join(' | ')} |`;

    return [
      line(header),
      `| ${width.map((w) => '-'.repeat(w)).join(' | ')} |`,
      ...rows.map(line)
    ].join('\n');
  }

  private async copyMarkdown(): Promise<void> {
    if (this.results.length === 0) return;
    try {
      await navigator.clipboard.writeText(this.markdownTable());
      this.copied = 'ok';
    } catch {
      // the clipboard needs a secure context and permission; say so rather than
      // resetting to idle, which would read as a dead button
      this.copied = 'fail';
    }
    setTimeout(() => (this.copied = 'idle'), 1800);
  }

  private renderRow(result: BenchmarkResult, index: number) {
    const reference = index === 0;
    const slower = !reference && result.percent < 99.5;
    const faster = !reference && result.percent > 100.5;

    return html`
      <tr class=${reference ? 'reference' : faster ? 'faster' : slower ? 'slower' : ''}>
        <td class="name">
          ${result.label}
          <small>${RslBenchmark.passSummary(result)}</small>
        </td>
        <td class="num">
          ${Number.isFinite(result.median) ? result.median.toFixed(3) : '—'}
          <div class="dev">
            ${result.deviation >= 0.0005 ? `± ${result.deviation.toFixed(3)}` : '± <0.001'}
            ${result.noisy
              ? html`<span
                  class="flag"
                  title="p10–p90 spread is over ${Math.round(
                    NOISE_THRESHOLD * 100
                  )}% of the median — close other GPU-heavy tabs, or take more samples"
                  >⚠</span
                >`
              : nothing}
          </div>
        </td>
        <td class="num dev">
          ${Number.isFinite(result.p10)
            ? `${result.p10.toFixed(3)}–${result.p90.toFixed(3)}`
            : '—'}
        </td>
        <td class="num pct">
          ${Number.isFinite(result.percent) ? `${result.percent.toFixed(0)}%` : '—'}
        </td>
      </tr>
    `;
  }

  override render() {
    const noisy = this.results.some((result) => result.noisy);
    const dropped = this.results.reduce((sum, result) => sum + result.dropped, 0);

    return html`
      <dialog @close=${() => this.emit('benchmark-close')}>
        <header>
          <h2>Benchmark</h2>
          <span class="spacer"></span>
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
                      <th class="num" title="Median GPU milliseconds per frame">GPU ms</th>
                      <th class="num" title="10th to 90th percentile of the samples">
                        p10–p90
                      </th>
                      <th class="num" title="Relative to the current pipeline">Perf.</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${this.results.map((result, index) => this.renderRow(result, index))}
                  </tbody>
                </table>
                <p class="hint">
                  Median GPU time per frame at ${this.note}, over
                  ${this.results[0]?.samples ?? 0} samples after warmup. <b>Perf.</b> is
                  relative to the current pipeline, so half the speed reads 50% — and it is
                  the steadier figure, since the absolute milliseconds drift as the GPU
                  warms and throttles. Ranks pipelines on <em>this</em> GPU — not a
                  prediction of handheld performance.
                  ${dropped > 0
                    ? html`<br />${dropped} sample${dropped === 1 ? '' : 's'} discarded by the
                        driver.`
                    : nothing}
                  ${noisy
                    ? html`<br /><span class="flag"
                          >⚠ Some results varied too much to trust — close other GPU-heavy tabs,
                          or take more samples.</span
                        >`
                    : nothing}
                </p>
              `
            : this.running
              ? nothing
              : html`<p class="hint">No results yet.</p>`}
        </div>
        <div class="foot">
          <button class="primary" ?disabled=${this.running} @click=${() => this.emit('benchmark-rerun')}>
            ↻ Run again
          </button>
          <button
            ?disabled=${this.running || this.results.length === 0}
            title="Copy the pipeline and Perf. columns as a markdown table"
            @click=${this.copyMarkdown}
          >
            ${this.copied === 'ok'
              ? '✓ Copied'
              : this.copied === 'fail'
                ? '✕ Blocked'
                : '⧉ Copy markdown'}
          </button>
          <label class="quality">
            <span>Samples</span>
            <select
              ?disabled=${this.running}
              .value=${this.quality}
              @change=${(e: Event) =>
                this.emit('benchmark-quality', (e.target as HTMLSelectElement).value)}
            >
              ${Object.entries(ROUND_PRESETS).map(
                ([key, rounds]) => html`
                  <option value=${key} ?selected=${key === this.quality}>
                    ${key[0].toUpperCase()}${key.slice(1)} · ${rounds}
                  </option>
                `
              )}
            </select>
          </label>
          <span class="spacer"></span>
          <button @click=${() => this.close()}>Close</button>
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
