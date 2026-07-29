/**
 * Shader library: the shaders bundled from NextUI's `Shaders/glsl` folder plus any
 * custom `.glsl` the user adds from a file or a URL (kept in localStorage).
 */
import manifest from '../generated/shader-manifest.json';
import { extractPragmaParameters } from './pragma-params.js';
import type { ShaderParam } from './types.js';

const CUSTOM_STORAGE_KEY = 'retroshader-lab:custom-shaders';
export const FINAL_SHADER = 'default.glsl';

/**
 * Per-shader source cap. localStorage gives a few MB for the whole origin, shared with the
 * saved session and the user presets, so a mistyped URL that returns a web page (or worse,
 * a binary) must be refused rather than allowed to fill the quota.
 */
export const MAX_SHADER_BYTES = 256 * 1024;

/** A screenshot bundled in `public/samples`, described by `public/samples/index.json`. */
export interface SampleEntry {
  file: string;
  system?: string;
  platform?: string;
  title: string;
  width?: number;
  height?: number;
}

/** Screenshots bundled in `public/samples`, picked up by `npm run shaders`. */
export const BUNDLED_SAMPLES: SampleEntry[] = manifest.samples ?? [];

/** Stock NextUI shader presets copied into `public/shaders/presets`. */
export const BUNDLED_PRESETS: string[] = manifest.presets ?? [];

/** Fetches one of the stock NextUI presets. */
export async function loadPreset(path: string): Promise<string> {
  const response = await fetch(`${import.meta.env.BASE_URL}shaders/presets/${path}`);
  if (!response.ok) throw new Error(`Failed to load preset ${path}: ${response.status}`);
  return response.text();
}

export interface ShaderEntry {
  name: string;
  source: string;
  params: ShaderParam[];
  custom: boolean;
}

/** Thrown for problems worth showing the user verbatim. */
export class ShaderSourceError extends Error {}

/**
 * Turns a file name or URL basename into a shader name: no path, always `.glsl`, and
 * nothing that would be mistaken for a directory.
 */
export function normalizeShaderName(raw: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? raw).trim().replace(/[?#].*$/, '');
  const stem = base.replace(/\.(glsl|frag|fs|vert|vs|txt)$/i, '').replace(/[^\w.-]+/g, '-');
  const cleaned = stem.replace(/^[-.]+/, '').replace(/[-.]+$/, '');
  return `${cleaned || 'shader'}.glsl`;
}

/**
 * Rejects anything that is plainly not shader source before it reaches storage. A wrong
 * URL usually returns an HTML error page, which would otherwise be saved happily and only
 * fail later at compile time with a confusing log.
 */
function assertLooksLikeGlsl(source: string): void {
  if (source.length > MAX_SHADER_BYTES) {
    throw new ShaderSourceError(
      `Shader is larger than ${Math.round(MAX_SHADER_BYTES / 1024)} KB, which is bigger than any real shader — check the link points at the source itself.`
    );
  }
  if (source.trim().length === 0) throw new ShaderSourceError('That file is empty.');
  if (/^\s*<(!doctype|html)\b/i.test(source)) {
    throw new ShaderSourceError(
      'That returned an HTML page rather than shader source. On GitHub, use the “Raw” link.'
    );
  }
  // every RetroArch-style shader has at least one of these
  if (!/\b(void\s+main|#pragma|gl_Position|FragColor|gl_FragColor)\b/.test(source)) {
    throw new ShaderSourceError('That does not look like GLSL source.');
  }
}

/**
 * Fetches shader source from a URL.
 *
 * This is a plain browser `fetch`, so it is subject to CORS: a `.glsl` sitting on a server
 * that sends no `Access-Control-Allow-Origin` cannot be read, and there is no way around
 * that without a server of our own to proxy through. Raw GitHub links and CDNs do send it.
 */
export async function fetchShaderSource(url: string): Promise<{ name: string; source: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new ShaderSourceError('That is not a valid URL.');
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new ShaderSourceError('Only http and https URLs can be loaded.');
  }

  let response: Response;
  try {
    response = await fetch(parsed.href);
  } catch {
    throw new ShaderSourceError(
      `Could not fetch that URL. The browser blocks cross-origin reads unless the server allows them, so use a raw.githubusercontent.com link or a CDN — or download the file and add it from disk.`
    );
  }
  if (!response.ok) {
    throw new ShaderSourceError(`That URL returned ${response.status} ${response.statusText}.`);
  }

  const source = await response.text();
  assertLooksLikeGlsl(source);
  return { name: normalizeShaderName(parsed.pathname), source };
}

/** Reads a dropped or picked file as shader source. */
export async function readShaderFile(file: File): Promise<{ name: string; source: string }> {
  if (file.size > MAX_SHADER_BYTES) {
    throw new ShaderSourceError(
      `${file.name} is larger than ${Math.round(MAX_SHADER_BYTES / 1024)} KB, which is bigger than any real shader.`
    );
  }
  const source = await file.text();
  assertLooksLikeGlsl(source);
  return { name: normalizeShaderName(file.name), source };
}

export class ShaderLibrary {
  private readonly entries = new Map<string, ShaderEntry>();

  get names(): string[] {
    return [...this.entries.keys()].sort((a, b) => a.localeCompare(b));
  }

  get all(): ShaderEntry[] {
    return this.names.map((name) => this.entries.get(name) as ShaderEntry);
  }

  /** The user's own shaders, which are the only ones that can be deleted. */
  get customEntries(): ShaderEntry[] {
    return this.all.filter((entry) => entry.custom);
  }

  get(name: string): ShaderEntry | undefined {
    return this.entries.get(name);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  paramsOf(name: string): ShaderParam[] {
    return this.entries.get(name)?.params ?? [];
  }

  /**
   * A name that is free, suffixing `-2`, `-3`… on collision.
   *
   * Shadowing a bundled shader is never allowed: presets reference shaders by file name, so
   * a custom `crt-perfect-v4.glsl` would silently change what every stock preset renders.
   */
  availableName(wanted: string): string {
    const name = normalizeShaderName(wanted);
    if (!this.entries.has(name)) return name;
    const stem = name.replace(/\.glsl$/, '');
    for (let n = 2; n < 1000; n++) {
      const candidate = `${stem}-${n}.glsl`;
      if (!this.entries.has(candidate)) return candidate;
    }
    return `${stem}-${Date.now().toString(36)}.glsl`;
  }

  /** Fetches the bundled shaders and restores custom ones from localStorage. */
  async load(): Promise<void> {
    const files: string[] = [FINAL_SHADER, ...manifest.shaders];
    const results = await Promise.all(
      files.map(async (file) => {
        const path = file === FINAL_SHADER ? 'shaders/default.glsl' : `shaders/glsl/${file}`;
        const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
        if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);
        return { name: file, source: await response.text() };
      })
    );

    for (const { name, source } of results) {
      this.entries.set(name, {
        name,
        source,
        params: extractPragmaParameters(source),
        custom: false
      });
    }

    for (const [name, source] of Object.entries(this.readCustom())) {
      this.entries.set(name, {
        name,
        source,
        params: extractPragmaParameters(source),
        custom: true
      });
    }
  }

  /** Adds (or replaces) a custom shader and persists it. */
  addCustom(name: string, source: string): ShaderEntry {
    const entry: ShaderEntry = {
      name,
      source,
      params: extractPragmaParameters(source),
      custom: true
    };
    this.entries.set(name, entry);
    const custom = this.readCustom();
    custom[name] = source;
    this.writeCustom(custom);
    return entry;
  }

  removeCustom(name: string): void {
    const entry = this.entries.get(name);
    if (!entry?.custom) return;
    this.entries.delete(name);
    const custom = this.readCustom();
    delete custom[name];
    this.writeCustom(custom);
  }

  /**
   * Persists a shader under a free name, throwing if localStorage refuses it.
   *
   * The write is checked rather than swallowed: a shader that vanishes on reload is worse
   * than one that was never accepted, because nothing would have said so at the time.
   */
  addFromText(wantedName: string, source: string): ShaderEntry {
    assertLooksLikeGlsl(source);
    const name = this.availableName(wantedName);
    const custom = this.readCustom();
    custom[name] = source;
    try {
      localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(custom));
    } catch {
      throw new ShaderSourceError(
        'Browser storage is full or disabled, so that shader could not be saved. Delete a custom shader and try again.'
      );
    }
    const entry: ShaderEntry = {
      name,
      source,
      params: extractPragmaParameters(source),
      custom: true
    };
    this.entries.set(name, entry);
    return entry;
  }

  private readCustom(): Record<string, string> {
    try {
      const raw = localStorage.getItem(CUSTOM_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  private writeCustom(custom: Record<string, string>): void {
    try {
      localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(custom));
    } catch {
      // storage full or disabled: custom shaders stay for the session only
    }
  }
}
