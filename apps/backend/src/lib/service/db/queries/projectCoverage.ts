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

  // currently-quarantined: count distinct (test, file, project) whose latest run
  // (per group) has quarantined=1. Expressed as a self-join on the per-test MAX(createdAt).
  const quarantinedCompiled = (() => {
    const latestSub = k
      .selectFrom('test_runs')
      .select((eb) => ['testId', 'fileId', 'project', eb.fn.max('createdAt').as('latest_at')])
      .groupBy(['testId', 'fileId', 'project'])
      .$if(!allProjects, (qb) => qb.where('project', '=', project));
    return k
      .selectFrom(latestSub.as('latest'))
      .innerJoin('test_runs as tr', (join) =>
        join
          .onRef('tr.testId', '=', 'latest.testId')
          .onRef('tr.fileId', '=', 'latest.fileId')
          .onRef('tr.project', '=', 'latest.project')
          .onRef('tr.createdAt', '=', 'latest.latest_at')
      )
      .select((eb) => eb.fn.countAll<number>().as('c'))
      .where('tr.quarantined', '=', 1)
      .compile();
  })();
  const currentlyQuarantined = (
    db.prepare(quarantinedCompiled.sql).get(...quarantinedCompiled.parameters) as { c: number }
  ).c;

  const qFailCompiled = k
    .selectFrom('test_runs')
    .select((eb) => eb.fn.countAll<number>().as('c'))
    .where('quarantined', '=', 1)
    .where('outcome', 'in', ['unexpected', 'flaky', 'failed'])
    .where('reportId', 'in', reportIds)
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
