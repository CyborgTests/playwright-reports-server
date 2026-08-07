import type { Kysely } from 'kysely';
import { getDatabase } from '../db.js';

// Search tests over tags/annotations
const RECREATE_FTS = `
  DROP TRIGGER IF EXISTS tests_fts_insert;
  DROP TRIGGER IF EXISTS tests_fts_delete;
  DROP TRIGGER IF EXISTS tests_fts_update;
  DROP TABLE IF EXISTS tests_fts;

  CREATE VIRTUAL TABLE tests_fts USING fts5(
    testId UNINDEXED,
    fileId UNINDEXED,
    project UNINDEXED,
    title,
    filePath,
    tags,
    latestAnnotations,
    tokenize = 'trigram'
  );

  CREATE TRIGGER tests_fts_insert AFTER INSERT ON tests BEGIN
    INSERT INTO tests_fts(testId, fileId, project, title, filePath, tags, latestAnnotations)
    VALUES (new.testId, new.fileId, new.project, new.title, new.filePath,
            new.tags, new.latestAnnotations);
  END;

  CREATE TRIGGER tests_fts_delete AFTER DELETE ON tests BEGIN
    DELETE FROM tests_fts
    WHERE testId = old.testId AND fileId = old.fileId AND project = old.project;
  END;

  CREATE TRIGGER tests_fts_update
  AFTER UPDATE OF title, filePath, tags, latestAnnotations ON tests
  WHEN new.title IS NOT old.title
    OR new.filePath IS NOT old.filePath
    OR new.tags IS NOT old.tags
    OR new.latestAnnotations IS NOT old.latestAnnotations
  BEGIN
    DELETE FROM tests_fts
    WHERE testId = old.testId AND fileId = old.fileId AND project = old.project;
    INSERT INTO tests_fts(testId, fileId, project, title, filePath, tags, latestAnnotations)
    VALUES (new.testId, new.fileId, new.project, new.title, new.filePath,
            new.tags, new.latestAnnotations);
  END;

  INSERT INTO tests_fts(testId, fileId, project, title, filePath, tags, latestAnnotations)
  SELECT testId, fileId, project, title, filePath, tags, latestAnnotations FROM tests;
`;

export async function up(_db: Kysely<unknown>): Promise<void> {
  const db = getDatabase();

  const migrate = db.transaction(() => {
    db.exec('ALTER TABLE tests ADD COLUMN latestAnnotations TEXT');
    db.exec(`
      UPDATE tests SET latestAnnotations = (
        SELECT tr.annotations FROM test_runs tr
        WHERE tr.testId = tests.testId AND tr.fileId = tests.fileId
          AND tr.project = tests.project AND tr.annotations IS NOT NULL
        ORDER BY tr.createdAt DESC LIMIT 1
      )
    `);
    db.exec(RECREATE_FTS);

    const { indexed } = db.prepare('SELECT COUNT(*) AS indexed FROM tests_fts').get() as {
      indexed: number;
    };
    const { total } = db.prepare('SELECT COUNT(*) AS total FROM tests').get() as { total: number };
    if (indexed !== total) {
      throw new Error(`0006: tests_fts backfill covered ${indexed} of ${total} tests`);
    }
    console.log(`[db] 0006 tests_fts rebuilt with tags + latestAnnotations (${total} tests)`);
  });
  migrate();
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  const db = getDatabase();
  const revert = db.transaction(() => {
    db.exec(`
      DROP TRIGGER IF EXISTS tests_fts_insert;
      DROP TRIGGER IF EXISTS tests_fts_delete;
      DROP TRIGGER IF EXISTS tests_fts_update;
      DROP TABLE IF EXISTS tests_fts;

      CREATE VIRTUAL TABLE tests_fts USING fts5(
        testId UNINDEXED,
        fileId UNINDEXED,
        project UNINDEXED,
        title,
        filePath,
        tokenize = 'trigram'
      );

      CREATE TRIGGER tests_fts_insert AFTER INSERT ON tests BEGIN
        INSERT INTO tests_fts(testId, fileId, project, title, filePath)
        VALUES (new.testId, new.fileId, new.project, new.title, new.filePath);
      END;

      CREATE TRIGGER tests_fts_delete AFTER DELETE ON tests BEGIN
        DELETE FROM tests_fts
        WHERE testId = old.testId AND fileId = old.fileId AND project = old.project;
      END;

      CREATE TRIGGER tests_fts_update AFTER UPDATE OF title, filePath ON tests BEGIN
        DELETE FROM tests_fts
        WHERE testId = old.testId AND fileId = old.fileId AND project = old.project;
        INSERT INTO tests_fts(testId, fileId, project, title, filePath)
        VALUES (new.testId, new.fileId, new.project, new.title, new.filePath);
      END;

      INSERT INTO tests_fts(testId, fileId, project, title, filePath)
      SELECT testId, fileId, project, title, filePath FROM tests;
    `);
    db.exec('ALTER TABLE tests DROP COLUMN latestAnnotations');
  });
  revert();
}
