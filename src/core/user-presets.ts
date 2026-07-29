/**
 * User presets: pipelines saved by hand, kept in localStorage next to the stock
 * NextUI ones.
 *
 * A preset stores the exact cfg text the panel shows, so loading one goes through the
 * same import path as a bundled preset and keeps everything a cfg can carry, including
 * core options the lab does not own.
 */

const STORAGE_KEY = 'retroshader-lab:user-presets';

export interface UserPreset {
  id: string;
  name: string;
  /** Full NextUI cfg text. */
  cfg: string;
  updatedAt: number;
}

function newId(): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export class UserPresetStore {
  private presets: UserPreset[] = [];

  constructor() {
    this.presets = this.read();
  }

  /** Presets in alphabetical order, which is how they are listed. */
  get all(): UserPreset[] {
    return [...this.presets].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): UserPreset | undefined {
    return this.presets.find((preset) => preset.id === id);
  }

  /** True when a name is already taken, so the caller can warn before overwriting. */
  hasName(name: string, exceptId?: string): boolean {
    const wanted = name.trim().toLowerCase();
    return this.presets.some(
      (preset) => preset.id !== exceptId && preset.name.toLowerCase() === wanted
    );
  }

  create(name: string, cfg: string): UserPreset {
    const preset: UserPreset = { id: newId(), name: name.trim(), cfg, updatedAt: Date.now() };
    this.presets = [...this.presets, preset];
    this.write();
    return preset;
  }

  update(id: string, patch: Partial<Pick<UserPreset, 'name' | 'cfg'>>): UserPreset | undefined {
    const preset = this.get(id);
    if (!preset) return undefined;
    const updated: UserPreset = {
      ...preset,
      ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
      ...(patch.cfg === undefined ? {} : { cfg: patch.cfg }),
      updatedAt: Date.now()
    };
    this.presets = this.presets.map((p) => (p.id === id ? updated : p));
    this.write();
    return updated;
  }

  remove(id: string): void {
    this.presets = this.presets.filter((preset) => preset.id !== id);
    this.write();
  }

  private read(): UserPreset[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as UserPreset[];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (preset): preset is UserPreset =>
          typeof preset?.id === 'string' &&
          typeof preset?.name === 'string' &&
          typeof preset?.cfg === 'string'
      );
    } catch {
      // corrupt storage: start empty rather than breaking the lab
      return [];
    }
  }

  private write(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.presets));
    } catch {
      // storage full or disabled: presets stay for the session only
    }
  }
}
