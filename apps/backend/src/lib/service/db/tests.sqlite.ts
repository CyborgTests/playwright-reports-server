// Barrel for the tests data-access layer, split by concern under ./tests/:
//   crud.sqlite.ts      → testDb (entity + run lifecycle)
//   queries.sqlite.ts   → testQueriesDb (derived / per-test reads)
//   analytics.sqlite.ts → testAnalyticsDb (windowed aggregates & failure analytics)

export { testAnalyticsDb } from './tests/analytics.sqlite.js';
export { testDb } from './tests/crud.sqlite.js';
export { testQueriesDb } from './tests/queries.sqlite.js';
export {
  convertDbRowToTestRun,
  type DerivedPageRow,
  type Test,
  type TestDetailStatsAggregate,
  type TestRunDbRow,
  type TestRunRow,
  type TestState,
  type TestWithQuarantineInfoRow,
} from './tests/shared.js';
