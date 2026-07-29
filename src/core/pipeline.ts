/**
 * WebGL2 reimplementation of NextUI's shader pipeline (`generic_video.c`).
 *
 * Rendering follows the C code exactly:
 *   source texture -> pass 1..N (FBO targets) -> `default.glsl` final scale pass
 *
 * Per pass:
 *   dst   = last * scale, or the destination rect when upscale is `screen` (scale 9)
 *   src   = srctype:  source | relative (previous pass output) | viewport
 *   tex   = scaletype: source | relative (previous pass output) | viewport
 * and the target texture of a pass is created with the *next* pass's filter, exactly
 * like `runShaderPass(..., next_filter, ...)`.
 *
 * Y orientation: the source is uploaded without `UNPACK_FLIP_Y_WEBGL`, matching
 * `glTexImage2D` of a top-down pixel buffer, and `default.glsl` flips Y at the end.
 * Keeping this quirk is what makes scanline/grid phase identical to the device.
 */
import { preprocessShader, withoutDerivativesExtension } from './glsl-preprocess.js';
import { extractPragmaParameters, defaultValue } from './pragma-params.js';
import { computeDstRect } from './scaling.js';
import type {
  CompileIssue,
  FilterName,
  PassConfig,
  PassSizes,
  PipelineConfig,
  Rect,
  ScaleTypeName,
  ShaderParam,
  SourceImage
} from './types.js';

/** Vertex data from `runShaderPass()`: x,y,z,w, u,v,s,t. */
const QUAD = new Float32Array([
  -1, 1, 0, 1, 0, 1, 0, 0, -1, -1, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 0, 0, 1, -1, 0, 1, 1, 0, 0, 0
]);

const IDENTITY_MATRIX = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** `PLAT_updateShader()` stores `optionIndex + 1`, so `screen` (index 8) becomes 9. */
export function upscaleToScale(upscale: string): number {
  return upscale === 'screen' ? 9 : Number.parseInt(upscale, 10);
}

function scaleTypeIndex(type: ScaleTypeName): number {
  return type === 'source' ? 0 : type === 'viewport' ? 2 : 1;
}

export interface CompiledShader {
  name: string;
  program: WebGLProgram | undefined;
  params: ShaderParam[];
  issues: CompileIssue[];
  /** True when the `GL_OES_standard_derivatives` extension line had to be dropped. */
  derivativesStripped: boolean;
  uniforms: {
    frameDirection: WebGLUniformLocation | null;
    frameCount: WebGLUniformLocation | null;
    outputSize: WebGLUniformLocation | null;
    textureSize: WebGLUniformLocation | null;
    inputSize: WebGLUniformLocation | null;
    origTextureSize: WebGLUniformLocation | null;
    origInputSize: WebGLUniformLocation | null;
    texture: WebGLUniformLocation | null;
    origTexture: WebGLUniformLocation | null;
    texelSize: WebGLUniformLocation | null;
    mvp: WebGLUniformLocation | null;
    params: Map<string, WebGLUniformLocation | null>;
  };
}

export interface PassRenderInfo {
  index: number;
  shader: string;
  sizes: PassSizes;
  /** RGBA pixels of the pass output, only filled when inspection is requested. */
  pixels?: Uint8Array;
}

export interface RenderResult {
  dstRect: Rect;
  passes: PassRenderInfo[];
  issues: CompileIssue[];
  warnings: string[];
}

/** `EXT_disjoint_timer_query_webgl2`, the only way to get real GPU timings. */
interface TimerExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export class ShaderPipeline {
  readonly gl: WebGL2RenderingContext;
  private readonly timer: TimerExtension | undefined;
  private origW = 1;
  private origH = 1;
  private maxTextureSize = 2048;
  private readonly cache = new Map<string, CompiledShader>();
  private vao: WebGLVertexArrayObject | undefined;
  private vbo: WebGLBuffer | undefined;
  private fbo: WebGLFramebuffer | undefined;
  private sourceTexture: WebGLTexture | undefined;
  private sourceKey = '';
  private readonly targets: (WebGLTexture | undefined)[] = [];
  private readonly targetSizes: { w: number; h: number }[] = [];
  private readonly pendingRuns = new Map<WebGLQuery, number>();

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;

    this.vao = gl.createVertexArray() ?? undefined;
    this.vbo = gl.createBuffer() ?? undefined;
    gl.bindVertexArray(this.vao ?? null);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo ?? null);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.fbo = gl.createFramebuffer() ?? undefined;
    this.maxTextureSize = (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) || 2048;
    this.timer =
      (gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null) ?? undefined;
  }

  /** Whether this context can report GPU time at all. */
  get canTime(): boolean {
    return this.timer !== undefined;
  }

  /**
   * Queues `iterations` renders inside one GPU timer query and returns a handle to it,
   * without waiting for the result.
   *
   * Wrapping `render()` in `performance.now()` would measure the CPU time spent queueing
   * commands, which is close to nothing and unrelated to how expensive a shader is. A
   * timer query instead reports what the GPU actually spent.
   *
   * Starting and reading are split because *waiting is the enemy of accuracy*. A GPU left
   * idle drops its clock, so the next sample measures a slower chip; that was once bad
   * enough to rank an expensive shader above a cheap one. Only one query may be **active**
   * at a time, but any number may be finished-and-unread, so a caller can keep submitting
   * batches and harvest them later, leaving the GPU continuously busy.
   */
  startTimedBatch(
    options: Parameters<ShaderPipeline['render']>[0],
    iterations = 1
  ): WebGLQuery | undefined {
    const gl = this.gl;
    const timer = this.timer;
    if (!timer) return undefined;

    const query = gl.createQuery();
    if (!query) return undefined;

    const runs = Math.max(1, iterations);
    this.pendingRuns.set(query, runs);
    gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    for (let i = 0; i < runs; i++) this.render(options);
    gl.endQuery(timer.TIME_ELAPSED_EXT);
    // submit now rather than at the end of the task, so the GPU starts on it immediately
    gl.flush();
    return query;
  }

  /**
   * Collects a batch started by `startTimedBatch`, without blocking.
   *
   * Returns `'pending'` while the result is still in flight, the GPU milliseconds **per
   * render** once it lands, or `undefined` when the driver flagged a disjoint — a context
   * switch or power event that invalidates the sample. Disjoint is only read once a result
   * is available, because reading the flag also clears it.
   */
  readTimedBatch(query: WebGLQuery): number | 'pending' | undefined {
    const gl = this.gl;
    const timer = this.timer;
    const runs = this.pendingRuns.get(query);
    if (!timer || runs === undefined) return undefined;

    if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return 'pending';

    const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT) as boolean;
    const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
    gl.deleteQuery(query);
    this.pendingRuns.delete(query);
    return disjoint ? undefined : nanoseconds / 1e6 / runs;
  }

  /** Drops every unread batch, so an abandoned run cannot leak its queries. */
  cancelTimedBatches(): void {
    for (const query of this.pendingRuns.keys()) this.gl.deleteQuery(query);
    this.pendingRuns.clear();
  }

  /** Compiles a shader file the way NextUI does, caching the result per file name. */
  compile(name: string, rawSource: string): CompiledShader {
    const cached = this.cache.get(name);
    if (cached) return cached;

    const gl = this.gl;
    const params = extractPragmaParameters(rawSource);
    const issues: CompileIssue[] = [];
    let derivativesStripped = false;

    const compileStage = (stage: 'vertex' | 'fragment'): WebGLShader | undefined => {
      const { source, rewrittenToEs3 } = preprocessShader(rawSource, stage);
      const type = stage === 'vertex' ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER;
      const attempts = rewrittenToEs3 ? [source, withoutDerivativesExtension(source)] : [source];

      let lastLog = '';
      let lastSource = source;
      for (const [attemptIndex, code] of attempts.entries()) {
        const shader = gl.createShader(type);
        if (!shader) return undefined;
        gl.shaderSource(shader, code);
        gl.compileShader(shader);
        if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          if (attemptIndex > 0) derivativesStripped = true;
          return shader;
        }
        lastLog = gl.getShaderInfoLog(shader) ?? '';
        lastSource = code;
        gl.deleteShader(shader);
      }
      issues.push({ pass: -1, shader: name, stage, log: lastLog, source: lastSource });
      return undefined;
    };

    const vertex = compileStage('vertex');
    const fragment = compileStage('fragment');
    let program: WebGLProgram | undefined;

    if (vertex && fragment) {
      const candidate = gl.createProgram();
      if (candidate) {
        gl.attachShader(candidate, vertex);
        gl.attachShader(candidate, fragment);
        gl.linkProgram(candidate);
        if (gl.getProgramParameter(candidate, gl.LINK_STATUS)) {
          program = candidate;
        } else {
          issues.push({
            pass: -1,
            shader: name,
            stage: 'link',
            log: gl.getProgramInfoLog(candidate) ?? '',
            source: ''
          });
          gl.deleteProgram(candidate);
        }
      }
    }
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);

    const u = (uniformName: string) =>
      program ? gl.getUniformLocation(program, uniformName) : null;
    const paramLocations = new Map<string, WebGLUniformLocation | null>();
    for (const param of params) paramLocations.set(param.name, u(param.name));

    const compiled: CompiledShader = {
      name,
      program,
      params,
      issues,
      derivativesStripped,
      uniforms: {
        frameDirection: u('FrameDirection'),
        frameCount: u('FrameCount'),
        outputSize: u('OutputSize'),
        textureSize: u('TextureSize'),
        inputSize: u('InputSize'),
        origTextureSize: u('OrigTextureSize'),
        origInputSize: u('OrigInputSize'),
        texture: u('Texture'),
        origTexture: u('OrigTexture'),
        texelSize: u('texelSize'),
        mvp: u('MVPMatrix'),
        params: paramLocations
      }
    };

    this.cache.set(name, compiled);
    return compiled;
  }

  getCompiled(name: string): CompiledShader | undefined {
    return this.cache.get(name);
  }

  /** Drops a cached program, e.g. when a custom shader source is edited. */
  invalidate(name: string): void {
    const compiled = this.cache.get(name);
    if (compiled?.program) this.gl.deleteProgram(compiled.program);
    this.cache.delete(name);
  }

  /** Default parameter values NextUI would start with for a shader. */
  defaultParams(name: string): Record<string, number> {
    const compiled = this.cache.get(name);
    const values: Record<string, number> = {};
    for (const param of compiled?.params ?? []) values[param.name] = defaultValue(param);
    return values;
  }

  private glFilter(filter: FilterName): number {
    return filter === 'LINEAR' ? this.gl.LINEAR : this.gl.NEAREST;
  }

  private uploadSource(source: SourceImage, filter: FilterName): void {
    const gl = this.gl;
    const key = `${source.id}:${source.width}x${source.height}:${filter}`;
    if (!this.sourceTexture) this.sourceTexture = gl.createTexture() ?? undefined;
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture ?? null);
    if (key !== this.sourceKey) {
      // No UNPACK_FLIP_Y: matches glTexImage2D() of a top-down buffer in NextUI.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source.bitmap);
      this.sourceKey = key;
    }
    const f = this.glFilter(filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private ensureTarget(index: number, w: number, h: number, filter: FilterName): WebGLTexture {
    const gl = this.gl;
    let texture = this.targets[index];
    if (!texture) {
      texture = gl.createTexture() ?? undefined;
      this.targets[index] = texture;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture ?? null);
    const f = this.glFilter(filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const size = this.targetSizes[index];
    if (!size || size.w !== w || size.h !== h) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.targetSizes[index] = { w, h };
    }
    return texture as WebGLTexture;
  }

  private runPass(
    compiled: CompiledShader,
    sizes: PassSizes,
    viewport: Rect,
    srcTexture: WebGLTexture,
    target: WebGLTexture | undefined,
    paramValues: Record<string, number>,
    frameCount: number
  ): void {
    const gl = this.gl;
    if (!compiled.program) return;

    gl.useProgram(compiled.program);
    gl.bindVertexArray(this.vao ?? null);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo ?? null);

    const stride = 8 * 4;
    const vertexCoord = gl.getAttribLocation(compiled.program, 'VertexCoord');
    if (vertexCoord >= 0) {
      gl.enableVertexAttribArray(vertexCoord);
      gl.vertexAttribPointer(vertexCoord, 4, gl.FLOAT, false, stride, 0);
    }
    const texCoord = gl.getAttribLocation(compiled.program, 'TexCoord');
    if (texCoord >= 0) {
      gl.enableVertexAttribArray(texCoord);
      gl.vertexAttribPointer(texCoord, 4, gl.FLOAT, false, stride, 4 * 4);
    }

    const u = compiled.uniforms;
    if (u.frameDirection) gl.uniform1i(u.frameDirection, 1);
    if (u.frameCount) gl.uniform1i(u.frameCount, frameCount);
    if (u.outputSize) gl.uniform2f(u.outputSize, sizes.dstw, sizes.dsth);
    if (u.textureSize) gl.uniform2f(u.textureSize, sizes.texw, sizes.texh);
    if (u.inputSize) gl.uniform2f(u.inputSize, sizes.srcw, sizes.srch);
    if (u.origTextureSize) gl.uniform2f(u.origTextureSize, this.origW, this.origH);
    if (u.origInputSize) gl.uniform2f(u.origInputSize, this.origW, this.origH);
    if (u.texelSize) gl.uniform2f(u.texelSize, 1 / sizes.texw, 1 / sizes.texh);
    if (u.mvp) gl.uniformMatrix4fv(u.mvp, false, IDENTITY_MATRIX);
    for (const [name, location] of u.params) {
      if (location) gl.uniform1f(location, paramValues[name] ?? 0);
    }

    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo ?? null);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        target,
        0
      );
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTexture);
    if (u.texture) gl.uniform1i(u.texture, 0);
    if (u.origTexture) {
      gl.uniform1i(u.origTexture, 1);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture ?? null);
      gl.activeTexture(gl.TEXTURE0);
    }

    gl.viewport(viewport.x, viewport.y, viewport.w, viewport.h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  /**
   * Renders the whole pipeline into the canvas.
   * `sources` maps a shader file name to its raw GLSL, `finalShader` is `default.glsl`.
   */
  render(options: {
    source: SourceImage;
    config: PipelineConfig;
    screenW: number;
    screenH: number;
    finalShaderName: string;
    inspect?: boolean;
  }): RenderResult {
    const gl = this.gl;
    const { source, config, screenW, screenH, finalShaderName, inspect } = options;
    const passes = config.passes;
    const issues: CompileIssue[] = [];
    const warnings: string[] = [];

    this.origW = source.width;
    this.origH = source.height;

    const dstRect = computeDstRect(
      config.scaling,
      source.width,
      source.height,
      screenW,
      screenH,
      config.coreAspect
    );

    const finalShader = this.cache.get(finalShaderName);
    const firstFilter = passes[0]?.filter ?? config.scaleFilter;
    this.uploadSource(source, firstFilter);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, screenW, screenH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const infos: PassRenderInfo[] = [];
    const allSizes = computePassSizes(passes, source.width, source.height, dstRect);
    let lastTexture = this.sourceTexture as WebGLTexture;
    let lastW = source.width;
    let lastH = source.height;

    for (const [i, pass] of passes.entries()) {
      const compiled = this.cache.get(pass.shader);
      if (!compiled?.program) {
        for (const issue of compiled?.issues ?? []) issues.push({ ...issue, pass: i });
        if (!compiled) warnings.push(`Pass ${i + 1}: shader "${pass.shader}" is not loaded`);
        continue;
      }
      if (compiled.derivativesStripped) {
        warnings.push(
          `${pass.shader}: dropped "#extension GL_OES_standard_derivatives" (core in ES 3.0, rejected by WebGL2)`
        );
      }

      const sizes = allSizes[i];
      if (
        sizes.dstw <= 0 ||
        sizes.dsth <= 0 ||
        sizes.dstw > this.maxTextureSize ||
        sizes.dsth > this.maxTextureSize
      ) {
        // Same guard as runShaderPass(): NextUI skips passes it cannot allocate.
        warnings.push(
          `Pass ${i + 1}: target ${sizes.dstw}×${sizes.dsth} exceeds the maximum texture size (${this.maxTextureSize}), pass skipped`
        );
        continue;
      }

      // The target texture gets the *next* pass's filter, like runShaderPass().
      const nextFilter = i === passes.length - 1 ? config.scaleFilter : passes[i + 1].filter;
      const target = this.ensureTarget(i, sizes.dstw, sizes.dsth, nextFilter);

      this.runPass(
        compiled,
        sizes,
        { x: 0, y: 0, w: sizes.dstw, h: sizes.dsth },
        lastTexture,
        target,
        pass.params,
        config.frameCount
      );

      const info: PassRenderInfo = { index: i, shader: pass.shader, sizes };
      if (inspect) info.pixels = this.readTarget(target, sizes.dstw, sizes.dsth);
      infos.push(info);

      lastTexture = target;
      lastW = sizes.dstw;
      lastH = sizes.dsth;
    }

    if (finalShader?.program) {
      const sizes: PassSizes = {
        srcw: lastW,
        srch: lastH,
        texw: lastW,
        texh: lastH,
        dstw: dstRect.w,
        dsth: dstRect.h
      };
      // GL viewport origin is bottom-left, the dst rect is expressed top-left.
      const viewport: Rect = {
        x: dstRect.x,
        y: screenH - dstRect.y - dstRect.h,
        w: dstRect.w,
        h: dstRect.h
      };
      if (passes.length === 0) lastTexture = this.sourceTexture as WebGLTexture;
      this.runPass(finalShader, sizes, viewport, lastTexture, undefined, {}, config.frameCount);
    } else {
      for (const issue of finalShader?.issues ?? []) issues.push({ ...issue, pass: -1 });
      warnings.push(`Final scale shader "${finalShaderName}" failed to compile`);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { dstRect, passes: infos, issues, warnings };
  }

  /** Reads back an intermediate pass target for the inspector. */
  private readTarget(texture: WebGLTexture, w: number, h: number): Uint8Array {
    const gl = this.gl;
    const pixels = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo ?? null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return pixels;
  }
}

/** Computes the pass sizes without rendering, used by the inspector and tests. */
export function computePassSizes(
  passes: PassConfig[],
  srcW: number,
  srcH: number,
  dstRect: Rect
): PassSizes[] {
  const sizes: PassSizes[] = [];
  let lastW = srcW;
  let lastH = srcH;

  for (const [i, pass] of passes.entries()) {
    const scale = upscaleToScale(pass.upscale);
    const dstw = scale === 9 ? dstRect.w : lastW * scale;
    const dsth = scale === 9 ? dstRect.h : lastH * scale;
    const realInputW = i === 0 ? srcW : lastW;
    const realInputH = i === 0 ? srcH : lastH;
    const srcIdx = scaleTypeIndex(pass.srctype);
    const scaleIdx = scaleTypeIndex(pass.scaletype);

    sizes.push({
      srcw: srcIdx === 0 ? srcW : srcIdx === 2 ? dstRect.w : realInputW,
      srch: srcIdx === 0 ? srcH : srcIdx === 2 ? dstRect.h : realInputH,
      texw: scaleIdx === 0 ? srcW : scaleIdx === 2 ? dstRect.w : realInputW,
      texh: scaleIdx === 0 ? srcH : scaleIdx === 2 ? dstRect.h : realInputH,
      dstw,
      dsth
    });

    lastW = dstw;
    lastH = dsth;
  }

  return sizes;
}
