/**
 * Shader library: the shaders bundled from NextUI's `Shaders/glsl` folder plus any
 * custom `.glsl` the user drops into the lab (kept in localStorage).
 */
import manifest from '../generated/shader-manifest.json';
import { extractPragmaParameters } from './pragma-params.js';
import type { ShaderParam } from './types.js';

const CUSTOM_STORAGE_KEY = 'retroshader-lab:custom-shaders';
export const FINAL_SHADER = 'default.glsl';

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

export class ShaderLibrary {
  private readonly entries = new Map<string, ShaderEntry>();

  get names(): string[] {
    return [...this.entries.keys()].sort((a, b) => a.localeCompare(b));
  }

  get all(): ShaderEntry[] {
    return this.names.map((name) => this.entries.get(name) as ShaderEntry);
  }

  get(name: string): ShaderEntry | undefined {
    return this.entries.get(name);
  }

  paramsOf(name: string): ShaderParam[] {
    return this.entries.get(name)?.params ?? [];
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
