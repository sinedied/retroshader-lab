/**
 * Encodes the lab's state into a URL, and back.
 *
 * Three things shape the format:
 *
 *  - **The payload lives in the URL fragment**, never the query string. A fragment is not
 *    sent to the server, so a static host cannot reject a long one with a 414, it stays
 *    out of server logs, and the only limit that applies is the browser's own.
 *  - **Only what differs from the defaults is written.** That keeps the ordinary link
 *    short, and it makes old links forward-compatible: a field added later is simply
 *    absent from an old payload and takes its default.
 *  - **The pipeline travels as cfg text**, the same serialization the app already exports
 *    and imports, rather than a second format that could drift away from the real one.
 *
 * A pristine stock preset is stored as a reference and carries no pipeline at all, so
 * sharing one is a few hundred characters. Anything modified, and any user preset, embeds
 * its cfg. Custom shaders are embedded only when the shared pipeline actually uses them.
 */
import { defaultState, type AppState, type ComparePane } from './state.js';
import { exportCfg, importCfg } from './cfg.js';
import { resolveParams, parsePaneRef } from './preset-config.js';
import type { PipelineConfig, ShaderParam } from './types.js';

/**
 * Payload format version. A reader that meets a higher number says so instead of decoding
 * a format it does not know into plausible-looking nonsense.
 */
const FORMAT_VERSION = 1;

/** Fragment key holding the payload. */
export const SHARE_KEY = 's';

/**
 * Above this the link still works in a browser but is likely to be truncated by chat
 * clients, mail clients and issue trackers, so the user is warned.
 */
export const WARN_LENGTH = 8000;
/** Above this the link is refused outright rather than handing back something broken. */
export const MAX_LENGTH = 16000;

/** A custom shader travelling with the link. */
export interface SharedShader {
  name: string;
  source: string;
}

/** A user preset travelling with the link, because a comparison pane points at it. */
export interface SharedPreset {
  id: string;
  name: string;
  cfg: string;
}

/**
 * The wire shape. Keys are terse because they are compressed but still repeated, and the
 * whole point is to stay inside a URL.
 */
interface SharePayload {
  v: number;
  /** Pristine stock preset, by path: no pipeline is stored with it. */
  p?: string;
  /** cfg text, when the pipeline is not a pristine stock preset. */
  c?: string;
  /** Name of the user preset the cfg came from, so the recipient sees it named. */
  n?: string;
  /**
   * Screen scaling and core aspect, carried apart from the cfg. They are output settings
   * the user owns rather than part of the preset — most presets do not mention scaling at
   * all — so folding them into the comparison would make every preset look edited.
   */
  sc?: string;
  ca?: number;
  /** Source selection. */
  ss?: string;
  sp?: string;
  sf?: string | null;
  /** Gambatte palette applied to a Game Boy screenshot. */
  gp?: string;
  /** Scroll direction and speed of the motion pattern. */
  smo?: boolean;
  sa?: number;
  ssp?: number;
  /** Output size. */
  ow?: number;
  oh?: number;
  /** View. */
  vm?: string;
  z?: number;
  px?: number;
  py?: number;
  /** Comparison. */
  cm?: string;
  pc?: number;
  pn?: (string | null)[];
  dv?: number[];
  cw?: number;
  ch?: number;
  el?: boolean;
  /** Panels. */
  cl?: Record<string, boolean>;
  sr?: boolean;
  sd?: boolean;
  si?: boolean;
  /** Custom shaders used by the pipeline or the panes. */
  sh?: SharedShader[];
  /**
   * User presets a comparison pane points at. Their ids mean nothing to a recipient, so
   * the cfg travels with the link and is registered transiently on arrival.
   */
  up?: SharedPreset[];
}

export interface ShareInput {
  state: AppState;
  paramsByShader: Map<string, ShaderParam[]>;
  /** Looks up a custom shader's source; bundled shaders return undefined. */
  customShader: (name: string) => string | undefined;
  /** Looks up a user preset a comparison pane points at, so its cfg can travel. */
  userPreset?: (id: string) => { name: string; cfg: string } | undefined;
  /**
   * cfg text of the stock preset currently selected, already normalised through
   * import/export, or undefined when there is none to compare against.
   */
  pristineStockCfg?: string;
  /** Name of the selected user preset, when one is selected. */
  userPresetName?: string;
}

export interface ShareResult {
  url: string;
  length: number;
  /** Over `WARN_LENGTH` but under `MAX_LENGTH`: usable, but fragile when pasted. */
  warning?: string;
  /** Per-shader cost, so an over-limit error can say what is responsible. */
  shaderCosts: { name: string; chars: number }[];
}

export class ShareError extends Error {}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * `deflate-raw` rather than `gzip`: a gzip member adds a header and a CRC trailer that buy
 * nothing inside a URL, and measured 18 bytes larger on a representative payload.
 */
async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([encoder.encode(text)])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return collect(stream as ReadableStream<Uint8Array>);
}

async function inflate(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return decoder.decode(await collect(stream as ReadableStream<Uint8Array>));
}

/** Whether the browser can encode or decode a link at all. */
export function canShare(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

/** Shader file names a pipeline and its comparison panes reference. */
function usedShaderNames(state: AppState): string[] {
  return [...new Set(state.pipeline.passes.map((pass) => pass.shader))];
}

function paneList(panes: [ComparePane, ComparePane]): (string | null)[] {
  return panes.map((pane) => pane.preset ?? null);
}

function sameNumbers(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, i) => Math.abs(value - b[i]) < 1e-9);
}

/** Builds the payload, writing only what differs from a fresh lab. */
function buildPayload(input: ShareInput): SharePayload {
  const { state } = input;
  const base = defaultState();
  const payload: SharePayload = { v: FORMAT_VERSION };

  const selected = state.selectedPreset;
  // Screen scaling is excluded from both sides of the comparison and carried separately:
  // it is an output setting the user owns, and most presets do not specify it, so
  // including it would make an untouched preset look edited.
  const cfg = exportCfg({
    config: state.pipeline,
    paramsByShader: input.paramsByShader,
    extras: state.cfgExtras,
    includeScreenScaling: false
  });

  if (selected?.kind === 'stock' && input.pristineStockCfg === cfg) {
    // unchanged stock preset: a reference is enough, the recipient has the same file
    payload.p = selected.id;
  } else {
    payload.c = cfg;
    if (selected?.kind === 'user' && input.userPresetName) payload.n = input.userPresetName;
  }

  if (state.pipeline.scaling !== base.pipeline.scaling) payload.sc = state.pipeline.scaling;
  if (Math.abs(state.pipeline.coreAspect - base.pipeline.coreAspect) > 1e-6) {
    payload.ca = +state.pipeline.coreAspect.toFixed(6);
  }

  if (state.sourceSystem !== base.sourceSystem) payload.ss = state.sourceSystem;
  if (state.sourcePattern !== base.sourcePattern) payload.sp = state.sourcePattern;
  if (state.sampleFile !== base.sampleFile) payload.sf = state.sampleFile ?? null;
  if (state.gbPalette !== base.gbPalette) payload.gp = state.gbPalette;
  if (state.scrollEnabled !== base.scrollEnabled) payload.smo = state.scrollEnabled;
  if (state.scrollAngle !== base.scrollAngle) payload.sa = state.scrollAngle;
  if (state.scrollSpeed !== base.scrollSpeed) payload.ssp = state.scrollSpeed;
  if (state.outputWidth !== base.outputWidth) payload.ow = state.outputWidth;
  if (state.outputHeight !== base.outputHeight) payload.oh = state.outputHeight;

  if (state.viewMode !== base.viewMode) payload.vm = state.viewMode;
  if (state.zoom !== base.zoom) payload.z = state.zoom;
  if (state.pan.x !== base.pan.x) payload.px = Math.round(state.pan.x);
  if (state.pan.y !== base.pan.y) payload.py = Math.round(state.pan.y);

  if (state.compareMode !== base.compareMode) payload.cm = state.compareMode;
  if (state.paneCount !== base.paneCount) payload.pc = state.paneCount;
  const panes = paneList(state.panes);
  if (panes.some((preset) => preset !== null)) payload.pn = panes;

  // a pane pointing at one of the user's presets has to carry it: the id alone means
  // nothing to whoever opens the link
  const userPresets: SharedPreset[] = [];
  for (const ref of panes) {
    if (!ref) continue;
    const parsed = parsePaneRef(ref);
    if (parsed.kind !== 'user' || userPresets.some((entry) => entry.id === parsed.id)) continue;
    const preset = input.userPreset?.(parsed.id);
    if (preset) userPresets.push({ id: parsed.id, name: preset.name, cfg: preset.cfg });
  }
  if (userPresets.length > 0) payload.up = userPresets;
  if (!sameNumbers(state.dividers, base.dividers)) payload.dv = state.dividers.map((d) => +d.toFixed(4));
  if (state.compareWidth !== base.compareWidth) payload.cw = state.compareWidth;
  if (state.compareHeight !== base.compareHeight) payload.ch = state.compareHeight;
  if (state.exportLabels !== base.exportLabels) payload.el = state.exportLabels;

  const collapsed = Object.fromEntries(Object.entries(state.collapsed).filter(([, v]) => v));
  if (Object.keys(collapsed).length > 0) payload.cl = collapsed;
  if (state.showRail !== base.showRail) payload.sr = state.showRail;
  if (state.showDock !== base.showDock) payload.sd = state.showDock;
  if (state.showInspector !== base.showInspector) payload.si = state.showInspector;

  // only the custom shaders this pipeline actually uses: having many stored locally must
  // not inflate a link that references one of them
  const shaders: SharedShader[] = [];
  for (const name of usedShaderNames(state)) {
    const source = input.customShader(name);
    if (source !== undefined) shaders.push({ name, source });
  }
  if (shaders.length > 0) payload.sh = shaders;

  return payload;
}

/** Cost of each embedded shader, measured by leaving it out and comparing. */
async function measureShaders(payload: SharePayload, total: number): Promise<
  { name: string; chars: number }[]
> {
  if (!payload.sh || payload.sh.length === 0) return [];
  const costs: { name: string; chars: number }[] = [];
  for (const shader of payload.sh) {
    const without = {
      ...payload,
      sh: payload.sh.filter((entry) => entry.name !== shader.name)
    };
    const encoded = toBase64Url(await deflate(JSON.stringify(without)));
    costs.push({ name: shader.name, chars: Math.max(0, total - encoded.length) });
  }
  return costs;
}

/**
 * Builds a shareable URL for the current state.
 *
 * Throws `ShareError` when the result would be too long to survive being pasted, naming
 * the shaders responsible so the message is actionable.
 */
export async function encodeShareUrl(input: ShareInput, baseUrl: string): Promise<ShareResult> {
  if (!canShare()) {
    throw new ShareError('This browser cannot compress the link (CompressionStream is missing).');
  }

  const payload = buildPayload(input);
  const encoded = toBase64Url(await deflate(JSON.stringify(payload)));

  const url = new URL(baseUrl);
  url.hash = `${SHARE_KEY}=${encoded}`;
  const full = url.toString();

  const shaderCosts = await measureShaders(payload, encoded.length);

  if (full.length > MAX_LENGTH) {
    const blame =
      shaderCosts.length > 0
        ? ` The embedded shaders account for most of it: ${shaderCosts
            .sort((a, b) => b.chars - a.chars)
            .map((cost) => `${cost.name} ≈ ${cost.chars.toLocaleString()}`)
            .join(', ')} characters. Remove a pass that uses one, or share the .glsl separately.`
        : '';
    throw new ShareError(
      `This setup needs ${full.length.toLocaleString()} characters, over the ${MAX_LENGTH.toLocaleString()} a URL can carry reliably.${blame}`
    );
  }

  const warning =
    full.length > WARN_LENGTH
      ? `This link is ${full.length.toLocaleString()} characters. It works in a browser, but some chat and mail clients truncate links this long.`
      : undefined;

  return { url: full, length: full.length, warning, shaderCosts };
}

export interface DecodedShare {
  /** State fields to apply over the current ones. */
  patch: Partial<AppState>;
  /** cfg to import, when the link did not reference a pristine stock preset. */
  cfg?: string;
  /** Stock preset to load by path. */
  stockPreset?: string;
  /** Name of the user preset the cfg came from, for labelling only. */
  presetName?: string;
  /** Output settings carried apart from the cfg; applied onto the pipeline. */
  scaling?: string;
  coreAspect?: number;
  shaders: SharedShader[];
  /** User presets the panes point at, to be held for the session only. */
  presets: SharedPreset[];
}

/** Reads the payload out of a URL fragment, or undefined when there is none. */
export function readShareFragment(hash: string): string | undefined {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw.length === 0) return undefined;
  const params = new URLSearchParams(raw);
  return params.get(SHARE_KEY) ?? undefined;
}

/** Turns a payload back into a state patch. Throws `ShareError` on anything unusable. */
export async function decodeShare(encoded: string): Promise<DecodedShare> {
  if (!canShare()) {
    throw new ShareError('This browser cannot read a shared link (DecompressionStream is missing).');
  }

  let payload: SharePayload;
  try {
    payload = JSON.parse(await inflate(fromBase64Url(encoded))) as SharePayload;
  } catch {
    throw new ShareError('That shared link is corrupt or incomplete.');
  }

  if (typeof payload !== 'object' || payload === null) {
    throw new ShareError('That shared link is corrupt or incomplete.');
  }
  if (typeof payload.v === 'number' && payload.v > FORMAT_VERSION) {
    throw new ShareError(
      'That link was made by a newer version of the lab and cannot be read here.'
    );
  }

  const patch: Partial<AppState> = {};
  if (payload.ss !== undefined) patch.sourceSystem = payload.ss;
  if (payload.sp !== undefined) patch.sourcePattern = payload.sp as AppState['sourcePattern'];
  if (payload.sf !== undefined) patch.sampleFile = payload.sf ?? undefined;
  if (typeof payload.gp === 'string') patch.gbPalette = payload.gp;
  if (typeof payload.smo === 'boolean') patch.scrollEnabled = payload.smo;
  if (typeof payload.sa === 'number') patch.scrollAngle = payload.sa;
  if (typeof payload.ssp === 'number') patch.scrollSpeed = payload.ssp;
  if (payload.ow !== undefined) patch.outputWidth = payload.ow;
  if (payload.oh !== undefined) patch.outputHeight = payload.oh;

  if (payload.vm !== undefined) patch.viewMode = payload.vm as AppState['viewMode'];
  if (payload.z !== undefined) patch.zoom = payload.z;
  if (payload.px !== undefined || payload.py !== undefined) {
    patch.pan = { x: payload.px ?? 0, y: payload.py ?? 0 };
  }

  if (payload.cm !== undefined) patch.compareMode = payload.cm as AppState['compareMode'];
  if (payload.pc === 2 || payload.pc === 3) patch.paneCount = payload.pc;
  if (payload.pn !== undefined) {
    const panes = payload.pn.slice(0, 2);
    patch.panes = [{ preset: panes[0] ?? undefined }, { preset: panes[1] ?? undefined }];
  }
  if (payload.dv !== undefined) patch.dividers = payload.dv;
  if (payload.cw !== undefined) patch.compareWidth = payload.cw;
  if (payload.ch !== undefined) patch.compareHeight = payload.ch;
  if (payload.el !== undefined) patch.exportLabels = payload.el;

  if (payload.cl !== undefined) patch.collapsed = payload.cl;
  if (payload.sr !== undefined) patch.showRail = payload.sr;
  if (payload.sd !== undefined) patch.showDock = payload.sd;
  if (payload.si !== undefined) patch.showInspector = payload.si;

  // a divider list that does not match the pane count would leave the layout inconsistent
  const paneCount = patch.paneCount ?? 2;
  if (patch.dividers && patch.dividers.length !== paneCount - 1) delete patch.dividers;

  return {
    patch,
    cfg: payload.c,
    stockPreset: payload.p,
    presetName: payload.n,
    scaling: payload.sc,
    coreAspect: payload.ca,
    shaders: Array.isArray(payload.sh)
      ? payload.sh.filter(
          (entry): entry is SharedShader =>
            typeof entry?.name === 'string' && typeof entry?.source === 'string'
        )
      : [],
    presets: Array.isArray(payload.up)
      ? payload.up.filter(
          (entry): entry is SharedPreset =>
            typeof entry?.id === 'string' &&
            typeof entry?.name === 'string' &&
            typeof entry?.cfg === 'string'
        )
      : []
  };
}

/**
 * Renders a preset's cfg text the way the app would after loading it, so the two can be
 * compared to decide whether the user has edited it.
 *
 * The parameter values must be resolved exactly as loading the preset resolves them —
 * `importCfg` returns them in a side table rather than on the passes — or every preset
 * would look edited and no link would ever use the short form.
 */
export function normaliseCfg(text: string, paramsByShader: Map<string, ShaderParam[]>): string {
  const imported = importCfg(text);
  const config: PipelineConfig = {
    scaling: imported.scaling ?? 'Aspect',
    scaleFilter: imported.scaleFilter ?? 'NEAREST',
    coreAspect: 4 / 3,
    passes: resolveParams(imported, (shader) => paramsByShader.get(shader) ?? []),
    frameCount: 0
  };
  return exportCfg({ config, paramsByShader, extras: imported.extras, includeScreenScaling: false });
}
