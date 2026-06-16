import { sql } from 'kysely';
import type { ProjectCoverageScope } from '../../../llm/prompts/index.js';
import { getDatabase } from '../db.js';
import { getKysely } from '../kysely.js';

export function computeProjectCoverageScope(
  reportIds: string[],
  priorReportIds: string[] | null,
  windowStartIso: string,
  windowEndIso: string,
  project: string
): ProjectCoverageScope | undefined {
  if (reportIds.length === 0) return undefined;
  const k = getKysely();
  const db = getDatabase();
  const allProjects = project === 'all';

  const totalTestsCompiled = (() => {
    let q = k.selectFrom('tests').select((eb) => eb.fn.countAll<number>().as('c'));
    if (!allProjects) q = q.where('project', '=', project);
    return q.compile();
  })();
  const totalTests = (
    db.prepare(totalTestsCompiled.sql).get(...totalTestsCompiled.parameters) as { c: number }
  ).c;

  const addedCompiled = (() => {
    let q = k
      .selectFrom('tests')
      .select((eb) => eb.fn.countAll<number>().as('c'))
      .where('createdAt', '>=', windowStartIso)
      .where('createdAt', '<=', windowEndIso);
    if (!allProjects) q = q.where('project', '=', project);
    return q.compile();
  })();
  const testsAddedInWindow = (
    db.prepare(addedCompiled.sql).get(...addedCompiled.parameters) as { c: number }
  ).c;

  const quarantinedCompiled = (() => {
    let q = k
      .selectFrom('tests')
      .select((eb) => eb.fn.countAll<number>().as('c'))
      .where('quarantined', '=', 1);
    if (!allProjects) q = q.where('project', '=', project);
    return q.compile();
  })();
  const currentlyQuarantined = (
    db.prepare(quarantinedCompiled.sql).get(...quarantinedCompiled.parameters) as { c: number }
  ).c;

  const qFailCompiled = k
    .selectFrom('test_runs as tr')
    .innerJoin('tests as t', (join) =>
      join
        .onRef('t.testId', '=', 'tr.testId')
        .onRef('t.fileId', '=', 'tr.fileId')
        .onRef('t.project', '=', 'tr.project')
    )
    .select((eb) => eb.fn.countAll<number>().as('c'))
    .where('t.quarantined', '=', 1)
    .where('tr.outcome', 'in', ['unexpected', 'flaky', 'failed'])
    .where('tr.reportId', 'in', reportIds)
    .compile();
  const quarantineFailuresInWindow = (
    db.prepare(qFailCompiled.sql).get(...qFailCompiled.parameters) as { c: number }
  ).c;

  const distinctCompiled = k
    .selectFrom('test_runs')
    .select(() => sql<number>`COUNT(DISTINCT testId || '::' || fileId || '::' || project)`.as('c'))
    .where('reportId', 'in', reportIds)
    .compile();
  const windowDistinctTests = (
    db.prepare(distinctCompiled.sql).get(...distinctCompiled.parameters) as { c: number }
  ).c;

  let priorDistinctTests: number | undefined;
  if (priorReportIds && priorReportIds.length > 0) {
    const priorCompiled = k
      .selectFrom('test_runs')
      .select(() =>
        sql<number>`COUNT(DISTINCT testId || '::' || fileId || '::' || project)`.as('c')
      )
      .where('reportId', 'in', priorReportIds)
      .compile();
    priorDistinctTests = (
      db.prepare(priorCompiled.sql).get(...priorCompiled.parameters) as { c: number }
    ).c;
  }

  type NearFlakeRow = {
    testId: string;
    fileId: string;
    title: string | null;
    filePath: string | null;
    c: number;
  };
  const nearFlakeCompiled = k
    .selectFrom('test_runs as tr')
    .leftJoin('tests as t', (join) =>
      join
        .onRef('t.testId', '=', 'tr.testId')
        .onRef('t.fileId', '=', 'tr.fileId')
        .onRef('t.project', '=', 'tr.project')
    )
    .select((eb) => [
      'tr.testId as testId',
      'tr.fileId as fileId',
      't.title as title',
      't.filePath as filePath',
      eb.fn.countAll<number>().as('c'),
    ])
    .where('tr.outcome', '=', 'flaky')
    .where('tr.reportId', 'in', reportIds)
    .groupBy(['tr.testId', 'tr.fileId', 'tr.project'])
    .orderBy('c', 'desc')
    .orderBy('tr.testId')
    .limit(5)
    .compile();
  const nearFlakeRows = db
    .prepare(nearFlakeCompiled.sql)
    .all(...nearFlakeCompiled.parameters) as NearFlakeRow[];
  const nearFlakes = nearFlakeRows.map((row) => ({
    testId: row.testId,
    fileId: row.fileId,
    title: row.title ?? row.testId,
    filePath: row.filePath ?? row.fileId,
    flakyOccurrences: row.c,
  }));

  return {
    totalTests,
    testsAddedInWindow,
    currentlyQuarantined,
    quarantineFailuresInWindow,
    windowDistinctTests,
    priorDistinctTests,
    nearFlakes,
  };
}
