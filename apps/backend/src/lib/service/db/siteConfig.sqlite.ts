import type { SiteWhiteLabelConfig } from '@playwright-reports/shared';
import { defaultConfig, isConfigValid, normalizeHeaderLinks } from '../../config.js';
import { getDatabase } from './db.js';
import { getKysely, type SiteConfigRow } from './kysely.js';
import { singletonOf } from './singleton.js';

export class SiteConfigDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();

  /** Seed the row with `defaultConfig` if missing. Idempotent. */
  public ensureSeeded(): void {
    if (this.getRow()) return;
    this.write(JSON.stringify(defaultConfig));
  }

  public get(): SiteWhiteLabelConfig {
    const row = this.getRow();
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
    this.write(JSON.stringify(merged));
    return merged;
  }

  private getRow(): SiteConfigRow | undefined {
    const compiled = this.k.selectFrom('site_config').selectAll().where('id', '=', 1).compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as SiteConfigRow | undefined;
  }

  private write(configJson: string): void {
    const now = new Date().toISOString();
    const compiled = this.k
      .insertInto('site_config')
      .values({ id: 1, config: configJson, updatedAt: now })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet((eb) => ({
          config: eb.ref('excluded.config'),
          updatedAt: eb.ref('excluded.updatedAt'),
        }))
      )
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }
}

export const siteConfigDb = singletonOf('siteConfig', () => new SiteConfigDatabase());
