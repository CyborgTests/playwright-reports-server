import type { SiteWhiteLabelConfig } from '@playwright-reports/shared';
import type Database from 'better-sqlite3';
import { defaultConfig, isConfigValid, normalizeHeaderLinks } from '../../config.js';
import { getDatabase } from './db.js';

const initiated = Symbol.for('playwright.reports.db.siteConfig');
const instance = globalThis as typeof globalThis & {
  [initiated]?: SiteConfigDatabase;
};

interface SiteConfigRow {
  id: number;
  config: string;
  updatedAt: string;
}

export class SiteConfigDatabase {
  private readonly db = getDatabase();

  private readonly getStmt: Database.Statement<[]>;
  private readonly upsertStmt: Database.Statement<[string, string]>;

  private constructor() {
    this.getStmt = this.db.prepare('SELECT * FROM site_config WHERE id = 1');
    this.upsertStmt = this.db.prepare(`
      INSERT INTO site_config (id, config, updatedAt)
      VALUES (1, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        config = excluded.config,
        updatedAt = excluded.updatedAt
    `);
  }

  public static getInstance(): SiteConfigDatabase {
    instance[initiated] ??= new SiteConfigDatabase();
    return instance[initiated];
  }

  /** Seed the row with `defaultConfig` if missing. Idempotent. */
  public ensureSeeded(): void {
    if (this.getStmt.get()) return;
    this.upsertStmt.run(JSON.stringify(defaultConfig), new Date().toISOString());
  }

  public get(): SiteWhiteLabelConfig {
    const row = this.getStmt.get() as SiteConfigRow | undefined;
    if (!row) return { ...defaultConfig };

    try {
      const parsed = JSON.parse(row.config);
      if (isConfigValid(parsed)) {
        return {
          ...defaultConfig,
          ...parsed,
          headerLinks: normalizeHeaderLinks(parsed.headerLinks),
        };
      }
      console.warn('[siteConfig] stored config failed validation — falling back to defaults');
    } catch (e) {
      console.warn(
        `[siteConfig] failed to parse stored config: ${e instanceof Error ? e.message : e}`
      );
    }
    return { ...defaultConfig };
  }

  public set(partial: Partial<SiteWhiteLabelConfig>): SiteWhiteLabelConfig {
    const current = this.get();
    const merged = { ...current, ...partial } as SiteWhiteLabelConfig;
    this.upsertStmt.run(JSON.stringify(merged), new Date().toISOString());
    return merged;
  }
}

export const siteConfigDb = SiteConfigDatabase.getInstance();
