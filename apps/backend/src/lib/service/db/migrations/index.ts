import type { Kysely } from 'kysely';
import { type Migration, Migrator } from 'kysely/migration';
import type { Database } from '../kysely.js';
import * as baseline from './0001_baseline.js';
import * as dropLegacyTables from './0002_drop_legacy_tables.js';
import * as seedDefaultDashboard from './0003_seed_default_dashboard.js';
import * as testFkCascade from './0004_test_fk_cascade.js';
import * as pruneIndexes from './0005_prune_indexes.js';
import * as promoteReportStats from './0006_promote_report_stats.js';
import * as testStateToTestLevel from './0007_test_state_to_test_level.js';
import * as pruneRedundantIndexes from './0008_prune_redundant_indexes.js';
import * as resetResolutionsDropSignatureGlobal from './0009_reset_resolutions_drop_signature_global.js';
import * as llmModelRegistry from './0010_llm_model_registry.js';
import * as mergeInfraIntoEnv from './0011_merge_infrastructure_into_environment.js';
import * as testTraceBaselines from './0012_test_trace_baselines.js';
import * as testRunsHasTrace from './0013_test_runs_has_trace.js';
import * as llmConcurrencyGroups from './0014_llm_concurrency_groups.js';
import * as promoteReportGitCi from './0015_promote_report_git_ci.js';
import * as entityTagsAndCommitSubject from './0016_entity_tags_and_commit_subject.js';
import * as promoteSkippedDropStats from './0017_promote_skipped_drop_stats.js';
import * as dropRedundantIndexes from './0018_drop_redundant_indexes.js';
import * as backfillSizeBytes from './0019_backfill_size_bytes.js';
import * as auth from './0020_auth.js';
import * as oauth from './0021_oauth.js';
import * as renameReaderToMember from './0022_rename_reader_to_member.js';
import * as apiKeyShareToken from './0023_api_key_share_token.js';
import * as legacyStoragePath from './0024_legacy_storage_path.js';

// Ordered, statically-imported migration set. The keys are the names Kysely
// records in its `kysely_migration` table; their lexical order is the run order,
// so keep the numeric prefixes. The baseline (0001) is frozen and must never be edited.
const MIGRATIONS: Record<string, Migration> = {
  '0001_baseline': { up: baseline.up, down: baseline.down },
  '0002_drop_legacy_tables': { up: dropLegacyTables.up, down: dropLegacyTables.down },
  '0003_seed_default_dashboard': { up: seedDefaultDashboard.up, down: seedDefaultDashboard.down },
  '0004_test_fk_cascade': { up: testFkCascade.up, down: testFkCascade.down },
  '0005_prune_indexes': { up: pruneIndexes.up, down: pruneIndexes.down },
  '0006_promote_report_stats': { up: promoteReportStats.up, down: promoteReportStats.down },
  '0007_test_state_to_test_level': {
    up: testStateToTestLevel.up,
    down: testStateToTestLevel.down,
  },
  '0008_prune_redundant_indexes': {
    up: pruneRedundantIndexes.up,
    down: pruneRedundantIndexes.down,
  },
  '0009_reset_resolutions_drop_signature_global': {
    up: resetResolutionsDropSignatureGlobal.up,
    down: resetResolutionsDropSignatureGlobal.down,
  },
  '0010_llm_model_registry': { up: llmModelRegistry.up, down: llmModelRegistry.down },
  '0011_merge_infrastructure_into_environment': {
    up: mergeInfraIntoEnv.up,
    down: mergeInfraIntoEnv.down,
  },
  '0012_test_trace_baselines': { up: testTraceBaselines.up, down: testTraceBaselines.down },
  '0013_test_runs_has_trace': { up: testRunsHasTrace.up, down: testRunsHasTrace.down },
  '0014_llm_concurrency_groups': {
    up: llmConcurrencyGroups.up,
    down: llmConcurrencyGroups.down,
  },
  '0015_promote_report_git_ci': {
    up: promoteReportGitCi.up,
    down: promoteReportGitCi.down,
  },
  '0016_entity_tags_and_commit_subject': {
    up: entityTagsAndCommitSubject.up,
    down: entityTagsAndCommitSubject.down,
  },
  '0017_promote_skipped_drop_stats': {
    up: promoteSkippedDropStats.up,
    down: promoteSkippedDropStats.down,
  },
  '0018_drop_redundant_indexes': {
    up: dropRedundantIndexes.up,
    down: dropRedundantIndexes.down,
  },
  '0019_backfill_size_bytes': {
    up: backfillSizeBytes.up,
    down: backfillSizeBytes.down,
  },
  '0020_auth': { up: auth.up, down: auth.down },
  '0021_oauth': { up: oauth.up, down: oauth.down },
  '0022_rename_reader_to_member': {
    up: renameReaderToMember.up,
    down: renameReaderToMember.down,
  },
  '0023_api_key_share_token': {
    up: apiKeyShareToken.up,
    down: apiKeyShareToken.down,
  },
  '0024_legacy_storage_path': {
    up: legacyStoragePath.up,
    down: legacyStoragePath.down,
  },
};

export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  const migrator = new Migrator({ db, provider: { getMigrations: async () => MIGRATIONS } });
  const { error, results } = await migrator.migrateToLatest();

  for (const result of results ?? []) {
    if (result.status === 'Success') {
      console.log(`[db] migration applied: ${result.migrationName}`);
    } else if (result.status === 'Error') {
      console.error(`[db] migration failed: ${result.migrationName}`);
    }
  }

  if (error) {
    throw error instanceof Error ? error : new Error(`db migration failed: ${String(error)}`);
  }
}
