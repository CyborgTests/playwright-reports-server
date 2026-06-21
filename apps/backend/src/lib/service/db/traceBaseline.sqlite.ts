import { getDatabase } from './db.js';
import { getKysely, type TestTraceBaselinesRow } from './kysely.js';
import { singletonOf } from './singleton.js';

export type TraceBaselineRow = TestTraceBaselinesRow;

export interface TraceBaselineUpsert {
  testId: string;
  fileId: string;
  project: string;
  sourceReportId: string;
  sourceCreatedAt: string;
  sourceOutcome: string;
  network: string;
  dom?: string | null;
}

export class TraceBaselineDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();

  public get(testId: string, fileId: string, project: string): TraceBaselineRow | null {
    const compiled = this.k
      .selectFrom('test_trace_baselines')
      .selectAll()
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .limit(1)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | TraceBaselineRow
      | undefined;
    return row ?? null;
  }

  public upsert(input: TraceBaselineUpsert): void {
    const now = new Date().toISOString();
    const compiled = this.k
      .insertInto('test_trace_baselines')
      .values({
        testId: input.testId,
        fileId: input.fileId,
        project: input.project,
        sourceReportId: input.sourceReportId,
        sourceCreatedAt: input.sourceCreatedAt,
        sourceOutcome: input.sourceOutcome,
        network: input.network,
        dom: input.dom ?? null,
        updatedAt: now,
      })
      .onConflict((oc) =>
        oc.columns(['testId', 'fileId', 'project']).doUpdateSet((eb) => ({
          sourceReportId: eb.ref('excluded.sourceReportId'),
          sourceCreatedAt: eb.ref('excluded.sourceCreatedAt'),
          sourceOutcome: eb.ref('excluded.sourceOutcome'),
          network: eb.ref('excluded.network'),
          dom: eb.ref('excluded.dom'),
          updatedAt: eb.ref('excluded.updatedAt'),
        }))
      )
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }
}

export const traceBaselineDb = singletonOf('traceBaseline', () => new TraceBaselineDatabase());
