/**
 * Measures how expensive each comparison pane's pipeline is on the GPU.
 *
 * Timing shaders from JavaScript is easy to get wrong: WebGL calls only queue work, so
 * wrapping a render in `performance.now()` measures the queueing, not the rendering.
 * `ShaderPipeline.timedRender()` uses a GPU timer query instead, and this module deals
 * with the two remaining sources of nonsense:
 *
 *  - **Warmup.** The first render of a pipeline compiles shaders and uploads textures,
 *    and measures around ten times its steady-state cost. Those rounds are discarded.
 *  - **Ordering.** GPU clocks ramp up and down during a run, so measuring all of pane A
 *    then all of pane B would systematically favour whichever went first. Rounds are
 *    interleaved across panes instead.
 */
import type { ShaderPipeline } from './pipeline.js';
import type { PipelineConfig, SourceImage } from './types.js';

export const WARMUP_ROUNDS = 5;
export const MEASURED_ROUNDS = 30;
/** Renders per timer query — keeps the GPU busy so its clock does not drop between samples. */
export const ITERATIONS_PER_SAMPLE = 10;

/** Above this relative standard deviation a result is too noisy to draw conclusions from. */
export const NOISE_THRESHOLD = 0.25;

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
  /** Mean GPU milliseconds per frame. */
  mean: number;
  /** Standard deviation, in milliseconds. */
  deviation: number;
  min: number;
  max: number;
  samples: number;
  /** Performance relative to the first target: slower renders score lower. */
  percent: number;
  /** True when the spread is wide enough that the mean should not be trusted. */
  noisy: boolean;
}

export interface BenchmarkOptions {
  source: SourceImage;
  screenW: number;
  screenH: number;
  finalShaderName: string;
  rounds?: number;
  /** Called after every round so the UI can show progress. */
  onProgress?: (done: number, total: number) => void;
  /** Checked between rounds so a run can be abandoned. */
  shouldCancel?: () => boolean;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[], average: number): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Runs the benchmark and resolves with one result per target, in the order given.
 * The first target is the reference every percentage is measured against.
 */
export async function runBenchmark(
  targets: BenchmarkTarget[],
  options: BenchmarkOptions
): Promise<BenchmarkResult[]> {
  const rounds = options.rounds ?? MEASURED_ROUNDS;
  const render = (target: BenchmarkTarget) =>
    target.pipeline.timedRender(
      {
        source: options.source,
        config: target.config,
        screenW: options.screenW,
        screenH: options.screenH,
        finalShaderName: options.finalShaderName
      },
      ITERATIONS_PER_SAMPLE
    );

  const samples = targets.map<number[]>(() => []);
  const total = (WARMUP_ROUNDS + rounds) * targets.length;
  let done = 0;

  for (let round = 0; round < WARMUP_ROUNDS + rounds; round++) {
    const measuring = round >= WARMUP_ROUNDS;
    // interleaved: one round of every pane before the next round of any
    for (const [index, target] of targets.entries()) {
      if (options.shouldCancel?.()) return [];
      const ms = await render(target);
      if (measuring && ms !== undefined) samples[index].push(ms);
      options.onProgress?.(++done, total);
    }
  }

  const results = targets.map((target, index) => {
    const values = samples[index];
    const average = values.length > 0 ? mean(values) : Number.NaN;
    const deviation = values.length > 0 ? standardDeviation(values, average) : 0;
    return {
      label: target.label,
      shaders: target.shaders,
      mean: average,
      deviation,
      min: values.length > 0 ? Math.min(...values) : Number.NaN,
      max: values.length > 0 ? Math.max(...values) : Number.NaN,
      samples: values.length,
      percent: 100,
      noisy: values.length > 0 && deviation / average > NOISE_THRESHOLD
    };
  });

  // percentages are relative to the first target: twice the time reads 50%
  const reference = results[0]?.mean;
  if (reference && Number.isFinite(reference)) {
    for (const result of results) {
      result.percent = Number.isFinite(result.mean) ? (reference / result.mean) * 100 : Number.NaN;
    }
  }

  return results;
}
