import { type Kysely, sql } from 'kysely';

// Per-task temperatures move from the global config.llm onto each registry model
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE llm_models ADD COLUMN testAnalysisTemperature REAL`.execute(db);
  await sql`ALTER TABLE llm_models ADD COLUMN reportSummaryTemperature REAL`.execute(db);
  await sql`ALTER TABLE llm_models ADD COLUMN projectSummaryTemperature REAL`.execute(db);

  await sql`
    UPDATE llm_models
    SET
      testAnalysisTemperature  = (SELECT json_extract(config, '$.llm.testAnalysisTemperature')  FROM site_config WHERE id = 1),
      reportSummaryTemperature = (SELECT json_extract(config, '$.llm.reportSummaryTemperature') FROM site_config WHERE id = 1),
      projectSummaryTemperature = (SELECT json_extract(config, '$.llm.projectSummaryTemperature') FROM site_config WHERE id = 1)
    WHERE isActive = 1
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE llm_models DROP COLUMN testAnalysisTemperature`.execute(db);
  await sql`ALTER TABLE llm_models DROP COLUMN reportSummaryTemperature`.execute(db);
  await sql`ALTER TABLE llm_models DROP COLUMN projectSummaryTemperature`.execute(db);
}
