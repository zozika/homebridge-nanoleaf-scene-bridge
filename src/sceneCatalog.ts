import fs from 'node:fs';

/** File in the Homebridge storage folder; the settings page reads it to offer the scenes for selection. */
export const SCENE_CATALOG_FILE = 'nanoleaf-scene-bridge-scenes.json';

export interface CatalogEntry {
  name: string;
  model: string;
  /** Every scene the device reports, before include / exclude filtering. */
  scenes: string[];
  updatedAt: string;
}

/** The scenes of every device seen so far, keyed by serial number. */
export class SceneCatalog {
  private entries: Record<string, CatalogEntry> = {};

  constructor(private readonly file: string) {
    try {
      this.entries = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, CatalogEntry>;
    } catch {
      this.entries = {};
    }
  }

  /** Stores the scene list of a device; writes the file only when something changed. */
  record(serialNo: string, name: string, model: string, scenes: string[]): void {
    const current = this.entries[serialNo];
    if (current && current.name === name && current.model === model && current.scenes.join('\n') === scenes.join('\n')) {
      return;
    }
    this.entries[serialNo] = { name, model, scenes: [...scenes], updatedAt: new Date().toISOString() };
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.entries, null, 2));
    } catch {
      // Only the settings page uses the catalog; the plugin works without it.
    }
  }
}
