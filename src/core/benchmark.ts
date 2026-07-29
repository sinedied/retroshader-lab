/**
 * Measures how expensive each comparison pane's pipeline is on the GPU.
 *
 * Timing shaders from JavaScript is easy to get wrong: WebGL calls only queue work, so
 * wrapping a render in `performance.now()` measures the queueing, not the rendering.
 * `ShaderPipeline` uses a GPU timer query instead, and this module deals with the four
 * remaining sources of nonsense:
 *
 *  - **Warmup.** The first render of a pipeline compiles shaders and uploads textures,
 *    and costs around ten times its steady state. Those rounds are discarded.
 *  - **Idle time.** This is the big one. A GPU that is left waiting drops its clock, so
 *    the next sample measures a slower chip. Submitting one batch and waiting for it
 *    gives a duty cycle low enough to swamp the differences being measured. Instead
 *    several rounds are kept queued at all times, so the GPU never runs dry.
 *  - **Quantization.** A pipeline costing tens of microseconds is near the resolution of
 *    the timer itself. Batch sizes are chosen per pipeline from its warmup cost, so every
 *    batch lasts about the same time regardless of how cheap the shader is.
 *  - **Outliers.** A compositor hitch or another tab stealing the GPU turns one sample
 *    into a large outlier. Results are summarised with median and percentiles rather than
 *    mean and standard deviation, which a single hitch would drag around.
 */
import type { ShaderPipeline } from './pipeline.js';
import type { PipelineConfig, SourceImage } from './types.js';

export const WARMUP_ROUNDS = 5;
export const MEASURED_ROUNDS = 30;

/** Iterations per batch during warmup, before the real cost of a pipeline is known. */
const WARMUP_ITERATIONS = 10;
/**
 * Minimum wall time spent warming up. Rounds alone are not enough: a GPU takes on the
 * order of a hundred milliseconds to raise its clock under load, and a short warmup was
 * measured handing back per-render costs five times the steady state — which then sized
 * every measured batch far too small.
 *
 * 400ms was not enough after the GPU had been left idle: the first quarter of a measured
 * run still read ~35% above the remaining three quarters. Warmup is the limiting factor
 * on accuracy far more than the number of samples is.
 */
const WARMUP_MS = 700;
/**
 * How long each measured batch should take on the GPU. Long enough to dwarf timer
 * quantization and fixed query overhead, short enough that the CPU can always stay ahead
 * of the GPU — if the CPU fell behind, the gaps would land *inside* the measurement.
 */
const TARGET_BATCH_MS = 12;
const MIN_ITERATIONS = 4;
/**
 * Ceiling on batch size. Queueing many hundreds of renders takes long enough on the CPU
 * that the GPU drains its queue while waiting for the commands, and the resulting stall
 * lands inside the *next* pane's measurement window. Raising this to 600 was measured
 * making a one-pass shader read the same cost as a three-pass one. A pipeline cheap
 * enough to hit this cap is measured a little more coarsely, and the noise flag says so.
 */
const MAX_ITERATIONS = 200;
/** Rounds kept in flight. The GPU always has this much queued, so it never idles. */
const QUEUE_DEPTH = 3;
/**
 * Wall time without a single result before a run gives up on its outstanding queries.
 * Deliberately a duration and not a poll count: polls are far quicker than a batch, so
 * counting them abandoned perfectly healthy queries a few milliseconds after submitting.
 */
const STALL_MS = 5000;

/** Above this p10–p90 spread, relative to the median, a result is too noisy to trust. */
export const NOISE_THRESHOLD = 0.25;

/**
 * How many measured rounds each quality setting runs.
 *
 * Measured on a desktop GPU, four repeats each, comparing how far the *ratio* between two
 * pipelines moved between runs — the ratio being the number the table exists to report:
 *
 * | rounds | time | ratio spread | absolute ms |
 * |--------|------|--------------|-------------|
 * | 30     | 0.7s | 4.6%         | steady      |
 * | 90     | 1.2s | 2.8%         | steady      |
 * | 300    | 3.0s | 2.0%         | drifts up   |
 *
 * So 90 is the knee of the curve. Beyond it the GPU has been under load long enough to
 * start throttling, and the absolute milliseconds climb run over run — more samples buy
 * precision on a quantity that is itself moving. `extended` is offered anyway for when a
 * genuinely small difference has to be resolved, and it is the ratio, not the absolute
 * time, that is worth reading from it.
 */
export const ROUND_PRESETS = { quick: 12, standard: 30, thorough: 90, extended: 300 } as const;
export type BenchmarkQuality = keyof typeof ROUND_PRESETS;

export interface BenchmarkTarget {
  label: string;
  /** Shader file names in the pipeline, for the "passes" column. */
  shaders: string[];
  pipeline: ShaderPipeline;
  config: PipelineConfig;
}

export interface BenchmarkResult {
  label: string;
  shaders: string[];
  /** Median GPU milliseconds per frame — the headline number. */
  median: number;
  /**
   * Robust stand-in for a standard deviation: the median absolute deviation, scaled so it
   * reads on the same scale as one. Unlike a standard deviation it barely moves when a
   * single sample is an outlier.
   */
  deviation: number;
  /** 10th and 90th percentile, so one hitch cannot stretch the reported spread. */
  p10: number;
  p90: number;
  samples: number;
  /** Renders per timed batch, chosen from this pipeline's warmup cost. */
  iterations: number;
  /** Samples the driver invalidated with a disjoint, or that never came back. */
  dropped: number;
  /** Performance relative to the first target: slower renders score lower. */
  percent: number;
  /** True when the spread is wide enough that the median should not be trusted. */
  noisy: boolean;
}

export interface BenchmarkOptions {
  source: SourceImage;
  screenW: number;
  screenH: number;
  finalShaderName: string;
  rounds?: number;
  /** Called as rounds complete so the UI can show progress. */
  onProgress?: (done: number, total: number) => void;
  /** Checked while running so a run can be abandoned. */
  shouldCancel?: () => boolean;
}

/**
 * Waits between polls for query results.
 *
 * The exact delay barely matters, and browsers clamp it to a few milliseconds anyway,
 * because `QUEUE_DEPTH` rounds are always queued: the GPU is working through its backlog
 * throughout, so polling slowly costs accuracy nothing and keeps the main thread free.
 * Spinning on a `MessageChannel` instead would poll sub-millisecond and burn the CPU for
 * no benefit.
 */
const sleep = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

/** Linear-interpolated percentile over values already sorted ascending. */
function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function median(values: number[]): number {
  return percentile(
    [...values].sort((a, b) => a - b),
    0.5
  );
}

/**
 * Median absolute deviation, scaled by the usual 1.4826 so that for clean data it matches
 * a standard deviation — which lets it stay readable in the same "± x ms" slot.
 */
function medianAbsoluteDeviation(values: number[], centre: number): number {
  if (values.length < 2) return 0;
  return 1.4826 * median(values.map((value) => Math.abs(value - centre)));
}

/**
 * Runs the benchmark and resolves with one result per target, in the order given.
 * The first target is the reference every percentage is measured against.
 * Resolves with an empty array when the run was cancelled.
 */
export async function runBenchmark(
  targets: BenchmarkTarget[],
  options: BenchmarkOptions
): Promise<BenchmarkResult[]> {
  const rounds = options.rounds ?? MEASURED_ROUNDS;
  const totalRounds = WARMUP_ROUNDS + rounds;
  const samples = targets.map<number[]>(() => []);
  const warmup = targets.map<number[]>(() => []);
  const dropped = targets.map(() => 0);
  const iterations = targets.map(() => WARMUP_ITERATIONS);

  /**
   * Picks a batch size for the next submission from the most recent evidence.
   *
   * Sizing once from warmup is not good enough: on a cold GPU warmup can read ten times
   * the steady-state cost, which locks in batches far too short for the whole run. Using
   * the tail of the samples collected so far lets the size converge as the clock settles.
   */
  const resize = (index: number): number => {
    const measured = samples[index];
    const recent =
      measured.length >= 4 ? measured.slice(-8) : warmup[index].slice(Math.floor(warmup[index].length / 2));
    const perRender = recent.length > 0 ? median(recent) : Number.NaN;
    if (!Number.isFinite(perRender) || perRender <= 0) return iterations[index];
    const wanted = Math.round(TARGET_BATCH_MS / perRender);
    return Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, wanted));
  };

  type Batch = { index: number; query: WebGLQuery; measuring: boolean };
  let outstanding: Batch[] = [];
  let roundsDone = 0;

  const renderOptions = (target: BenchmarkTarget) => ({
    source: options.source,
    config: target.config,
    screenW: options.screenW,
    screenH: options.screenH,
    finalShaderName: options.finalShaderName
  });

  const submitRound = (round: number) => {
    const measuring = round >= WARMUP_ROUNDS;
    for (const [index, target] of targets.entries()) {
      if (measuring) iterations[index] = resize(index);
      const query = target.pipeline.startTimedBatch(renderOptions(target), iterations[index]);
      if (query) outstanding.push({ index, query, measuring });
    }
  };

  /** Collects every batch whose result has landed. Returns how many were collected. */
  const harvest = (): number => {
    const remaining: Batch[] = [];
    let collected = 0;
    for (const batch of outstanding) {
      const result = targets[batch.index].pipeline.readTimedBatch(batch.query);
      if (result === 'pending') {
        remaining.push(batch);
        continue;
      }
      collected++;
      if (result === undefined) dropped[batch.index]++;
      else (batch.measuring ? samples : warmup)[batch.index].push(result);
    }
    outstanding = remaining;
    return collected;
  };

  const cancelAll = () => {
    for (const target of targets) target.pipeline.cancelTimedBatches();
    outstanding = [];
  };

  try {
    // Warmup runs first and on its own: its renders bring the GPU up to speed, and its
    // timings decide how big the measured batches need to be. It is time-boxed rather
    // than round-counted because what matters is how long the chip has been under load.
    const warmupStart = performance.now();
    let lastProgress = performance.now();
    for (;;) {
      if (options.shouldCancel?.()) return [];
      const warming = performance.now() - warmupStart < WARMUP_MS;
      if (warming) {
        while (outstanding.length < QUEUE_DEPTH * targets.length) submitRound(0);
      } else if (outstanding.length === 0) {
        break;
      }
      await sleep();
      if (harvest() > 0) lastProgress = performance.now();
      else if (performance.now() - lastProgress > STALL_MS) break;
      // warmup is time-boxed, so report its share of the bar by elapsed time rather than
      // leaving the user watching a bar stuck at zero for the first half of the run
      const elapsed = Math.min(1, (performance.now() - warmupStart) / WARMUP_MS);
      options.onProgress?.(elapsed * WARMUP_ROUNDS, totalRounds);
    }
    roundsDone = WARMUP_ROUNDS;
    options.onProgress?.(roundsDone, totalRounds);


    // Measured rounds, keeping QUEUE_DEPTH rounds queued so the GPU never runs dry.
    let submitted = WARMUP_ROUNDS;
    let collectedRounds = 0;
    lastProgress = performance.now();
    while (submitted < totalRounds || outstanding.length > 0) {
      if (options.shouldCancel?.()) return [];
      while (submitted < totalRounds && outstanding.length < QUEUE_DEPTH * targets.length) {
        submitRound(submitted);
        submitted++;
      }
      await sleep();
      const collected = harvest();
      if (collected > 0) lastProgress = performance.now();
      else if (performance.now() - lastProgress > STALL_MS) break;
      collectedRounds += collected / targets.length;
      const done = Math.min(totalRounds, WARMUP_ROUNDS + Math.floor(collectedRounds));
      if (done > roundsDone) {
        roundsDone = done;
        options.onProgress?.(roundsDone, totalRounds);
      }
    }
    // anything still unread is abandoned rather than retried, so one wedged query
    // cannot hang the run
    for (const batch of outstanding) dropped[batch.index]++;
  } finally {
    cancelAll();
  }

  const results = targets.map<BenchmarkResult>((target, index) => {
    const values = samples[index];
    const sorted = [...values].sort((a, b) => a - b);
    const centre = values.length > 0 ? percentile(sorted, 0.5) : Number.NaN;
    const p10 = values.length > 0 ? percentile(sorted, 0.1) : Number.NaN;
    const p90 = values.length > 0 ? percentile(sorted, 0.9) : Number.NaN;
    return {
      label: target.label,
      shaders: target.shaders,
      median: centre,
      deviation: values.length > 0 ? medianAbsoluteDeviation(values, centre) : 0,
      p10,
      p90,
      samples: values.length,
      iterations: iterations[index],
      dropped: dropped[index],
      percent: 100,
      noisy: centre > 0 && (p90 - p10) / centre > NOISE_THRESHOLD
    };
  });

  // percentages are relative to the first target: twice the time reads 50%
  const reference = results[0]?.median;
  if (reference !== undefined && Number.isFinite(reference) && reference > 0) {
    for (const result of results) {
      result.percent =
        Number.isFinite(result.median) && result.median > 0
          ? (reference / result.median) * 100
          : Number.NaN;
    }
  }

  return results;
}
