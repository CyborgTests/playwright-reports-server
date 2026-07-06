#!/usr/bin/env node
import { createRequire } from 'node:module';
import { type ParseArgsConfig, parseArgs } from 'node:util';
import { CliHttpError } from './client.js';
import { runAttachment } from './commands/attachment.js';
import { runCategoryList } from './commands/category.js';
import {
  runClusterBrief,
  runClusterList,
  runClusterReopen,
  runClusterResolve,
} from './commands/cluster.js';
import { runConfigCommand } from './commands/config.js';
import { runTestFeedbackClear, runTestFeedbackUpsert } from './commands/feedback.js';
import { runPing } from './commands/ping.js';
import { runProjectList, runProjectSummarySubmit } from './commands/project.js';
import { runRegressionList } from './commands/regression.js';
import {
  runReportBrief,
  runReportCompare,
  runReportLatest,
  runReportList,
  runReportResolve,
  runReportSummarySubmit,
} from './commands/report.js';
import { runStats } from './commands/stats.js';
import { runProjectSummary, runReportSummary } from './commands/summary.js';
import { runTagList } from './commands/tag.js';
import {
  runTestAnalysis,
  runTestAnalysisPrompt,
  runTestAnalysisSubmit,
  runTestBrief,
  runTestFailureContext,
  runTestFeedbackRelated,
  runTestFind,
  runTestFromFile,
  runTestHistory,
  runTestSearch,
  runTestSignatureHistory,
} from './commands/test.js';
import { CliConfigError } from './config.js';

const requireFromHere = createRequire(import.meta.url);
const pkg = requireFromHere('../package.json') as { version: string };

const HELP = [
  'pwrs-cli - Playwright Reports Server access for coding agents',
  '',
  'Usage:',
  '  pwrs-cli <command> [args] [options]',
  '',
  'Discovery:',
  '  project list                           List projects known to the server',
  '  project summary [--project <p>]        Persisted LLM project health summary',
  '  tag list [--project <p>]               List report tags',
  '  category list [--project <p>]          List failure categories (for --failure-category)',
  '  report list [filters]                  List reports (filters below)',
  '  report compare <a|latest|prev> <b|latest|prev> [--project <p>] [--limit N]',
  '                                          Diff two reports (accepts `latest` / `prev` keywords)',
  '  cluster list [filters]                 Active failure clusters across reports (--include-resolved to show all)',
  '  regression list [filters]              Impact-ranked regressions (tests that broke after a green streak)',
  '  stats [filters]                        Aggregate health + trend totals for a window',
  '  ping                                   Sanity-check the server is reachable',
  '',
  'Drill-down (you already have an ID):',
  '  test find <query>                      Resolve a test name → testId',
  '  test from-file <path>[:line]           Resolve a spec file → testIds (line narrows by proximity)',
  '  test brief <testId>                     Everything we know about this test',
  '  test analysis <testId>                 Full persisted LLM analysis markdown',
  '  test failure-context <testId> --report-id <id>',
  '                                          Current would-be prompt + typed evidence envelope',
  '  test analysis-prompt <testId> --report-id <id>',
  '                                          Verbatim prompt from the latest completed analysis task',
  '  test history <testId> [--limit N]      Per-run history + signature rollup',
  '  test signature-history <testId> --report-id <id>',
  '                                          Prior occurrences of this failure signature (all reports)',
  '  test feedback-related <testId> --report-id <id>',
  '                                          Feedback on the same test in other projects',
  '  test search [filters]                  Search tests by tier / status / sort / category',
  "  report latest [--with-failures]        Latest report's brief (compact by default)",
  "  report brief <reportId> [--with-failures]   Specific report's brief",
  '  report summary <reportId>              Persisted LLM failure summary for a report',
  '  report resolve <displayNumber>         Resolve a `#479` to its UUID reportId',
  '  cluster brief <clusterId>              Drill into one cluster: brief per member test',
  '  cluster resolve <clusterId>            Mark a cluster as resolved (write)',
  '  cluster reopen <clusterId>             Re-open a resolved cluster (write)',
  '  attachment <url>                       Fetch screenshot/error-context with Bearer auth',
  '',
  'Authoring & feedback (write - only when the user explicitly asks):',
  '  test analysis-submit <testId> --report-id <id> --analysis-file <path|-> --model <name>',
  '                                          POST a fresh analysis (refused with 409 when one exists)',
  '  test feedback <testId> --comment "..." [--report-id <id>]',
  '                                          Persist a dissent/correction note on an existing analysis',
  '  test feedback-clear <testId>            Clear the feedback note',
  '  report summary-submit <reportId> --summary-file <path|-> --model <name>',
  '                                          POST a report-level failure summary (409 on existing)',
  '  project summary-submit --summary-file <path|-> --model <name> [--project <p>]',
  '                                          POST a project-level health digest (409 on existing)',
  '',
  'Config:',
  '  config set <server|token> <value>     Persist config to ~/.config/pwrs-cli/config.json',
  '  config get [<server|token>]            Show config (token masked)',
  '',
  'Common filters (where supported):',
  '  --project <p>                          Scope to a project',
  '  --from <ISO-date>                      Window start (e.g. 2026-05-13 or full ISO)',
  '  --to <ISO-date>                        Window end',
  '  --limit <N>                            Cap output (defaults vary by command)',
  '  --offset <N>                           Pagination offset',
  '  --search <q>                           Free-text search',
  '  --tags <a,b,c>                         Comma-separated tag filter (report list)',
  '  --pass-rate <all|passing|failing|below-threshold>   Report pass-rate filter',
  '  --tier <stable|flaky|critical>         Comma-separated; test search',
  '  --status <quarantined|not-quarantined|all>   test search',
  '  --failure-category <c>                 test search (use `category list` to enumerate)',
  '  --sort slowest                         test search ordering',
  '  --failed-only                          stats: scope to runs with failures',
  '  --with-failures                        report brief/latest: include full per-failure briefs',
  '  --help                                 Show this message',
  '  --version                              Print CLI version and exit',
  '',
  'Per-command usage:',
  '  pwrs-cli help <command>                e.g. `pwrs-cli help test`, `pwrs-cli help report`',
  '',
  'Environment:',
  '  PWRS_SERVER_URL                         Server URL (overrides saved config)',
  '  PWRS_API_TOKEN                          API token (overrides saved config)',
  '  PWRS_PROJECT                            Default --project (explicit --project still wins)',
  '',
].join('\n');

const GROUP_HELP: Record<string, string> = {
  test: [
    'pwrs-cli test - test-level drill-down',
    '',
    'Subcommands:',
    '  test find <query> [--project <p>] [--limit N]',
    '      Resolve a test name → testId (default --limit 10).',
    '  test from-file <path>[:line] [--project <p>] [--limit N]',
    '      Resolve a spec file → testIds. With :line, sorts by proximity to that line.',
    '  test brief <testId> [--project <p>]',
    '      One-shot brief (signals, latest failure, LLM analysis, feedback, cluster).',
    '      --project optional - server resolves from latest test_runs row.',
    '  test analysis <testId> [--project <p>]',
    '      Full persisted LLM analysis markdown (unmodified, no regex split).',
    '  test failure-context <testId> --report-id <id> [--project <p>]',
    '      The prompt the analysis queue would feed the LLM for this test right now,',
    '      plus a typed evidence envelope (codeframe, step tree, ARIA snapshot,',
    '      git/CI metadata, console + network events, history). Lets external coding',
    '      agents pull every signal we have without going through the LLM.',
    '  test analysis-prompt <testId> --report-id <id> [--project <p>] [--task-id <id>]',
    '      Verbatim prompt from the latest completed test_analysis task (mirrors the',
    '      in-report "Copy prompt" button). Pass --task-id to address a specific run.',
    '  test history <testId> [--project <p>] [--limit N]',
    '      Per-run history + signatureGroups rollup. Default --limit 20, max 50.',
    '  test signature-history <testId> (--report-id <id> | --file-id <id> --error-signature <sig>)',
    '      Count + first occurrence of one failure signature across ALL reports (not the',
    '      ~50-run window `test history` covers). Answers "is this break new or recurring?".',
    '  test feedback-related <testId> (--report-id <id> | --file-id <id> --exclude-project <p>)',
    '      Feedback notes + latest analysis on the same test in OTHER projects, with a flag',
    "      for entries that share this run's error signature. Up to 5 entries.",
    '  test search [filters]',
    '      Open-ended search. Supports --tier, --status, --failure-category, --sort slowest,',
    '      --search, --from/--to, --limit (default 20, max 100), --offset.',
    '  test analysis-submit <testId> --report-id <id> --analysis-file <path|-> --model <name> [--category <c>] [--force]',
    '      POST a fresh analysis (use `-` to read from stdin). Refused with 409 when an',
    '      analysis already exists for (testId, reportId) - route to `test feedback` instead.',
    '      --force overwrites; only use after explicit user confirmation.',
    '  test feedback <testId> --comment "..." [--report-id <id> | --file-id <id> --project <p>]',
    '      Upsert a dissent/correction note on an existing analysis. The server requires either',
    '      reportId, or fileId+project, to resolve the test_runs row.',
    '  test feedback-clear <testId> [--report-id <id> | --file-id <id> --project <p>]',
    '      Remove the feedback note for a test.',
    '',
  ].join('\n'),
  report: [
    'pwrs-cli report - report-level drill-down',
    '',
    'Subcommands:',
    '  report list [filters]',
    '      Filters: --project, --search, --tags, --from/--to,',
    '      --pass-rate <all|passing|failing|below-threshold>, --limit, --offset.',
    '  report latest [--project <p>] [--with-failures]',
    "      Latest report's brief (compact by default).",
    '  report brief <reportId> [--with-failures]',
    "      Specific report's brief. Summary mode is ~5 KB; full mode is ~100 KB for 50 failures.",
    '  report summary <reportId>',
    '      Persisted LLM failure summary for a report (404 if not generated yet).',
    '  report resolve <displayNumber> [--project <p>]',
    '      Resolve a `#479`-style displayNumber to UUID reportId(s).',
    '  report compare <reportIdA|latest|prev> <reportIdB|latest|prev> [--project <p>] [--limit N]',
    '      Diff two reports - buckets: newlyFailed, fixed, stillFailing, flakyToPass, etc.',
    '      Accepts UUID reportIds and the keywords `latest` / `prev`.',
    '  report summary-submit <reportId> --summary-file <path|-> --model <name> [--structured-file <path|->] [--force]',
    '      POST a report-level failure summary authored by an external agent.',
    '      Refused with 409 when one exists; --force overwrites (require user confirmation).',
    '      --structured-file accepts the typed `ReportAnalysisStructured` JSON for verdict rendering.',
    '',
  ].join('\n'),
  cluster: [
    'pwrs-cli cluster - failure-cluster drill-down & lifecycle',
    '',
    'Subcommands:',
    '  cluster list [--project <p>] [--from/--to] [--limit N] [--include-resolved]',
    '      Active failure clusters across reports (default --limit 10). Each cluster',
    '      is anchored to one fix target: fixture / selector / frame / signature / unmatched.',
    '      Pass --include-resolved to include resolved clusters. Each cluster carries',
    '      lifecycle (active|resolved|unattributed) and resolution fields.',
    '  cluster brief <clusterId> [--project <p>]',
    '      Drill into one cluster: brief per member test (capped at 50 members).',
    '      Cluster IDs are deterministic (sha1 of the anchor) and stable across calls.',
    '  cluster resolve <clusterId> [--project <p>] [--note "..."]',
    '      Mark a cluster as resolved. Optional --note for resolution context (PR, commit, etc.).',
    '  cluster reopen <clusterId> [--project <p>] [--note "..."]',
    '      Re-open a previously resolved cluster.',
    '',
  ].join('\n'),
  project: [
    'pwrs-cli project - project-level info',
    '',
    'Subcommands:',
    '  project list',
    '      List projects known to the server.',
    '  project summary [--project <p>]',
    '      Persisted LLM project health summary. Omit --project (or pass `all`) for cross-project.',
    '  project summary-submit [--project <p>] --summary-file <path|-> --model <name>',
    '      [--structured-file <path|->] [--last-report-id <id>] [--report-count N]',
    '      [--first-report-at <ISO>] [--last-report-at <ISO>] [--force]',
    '      POST a project health digest authored by an external agent. Defaults to project=all.',
    '      Refused with 409 when one exists; --force overwrites (require user confirmation).',
    '',
  ].join('\n'),
  tag: [
    'pwrs-cli tag - report tags',
    '',
    'Subcommands:',
    '  tag list [--project <p>]    List report tags (pairs with `report list --tags <a,b>`).',
    '',
  ].join('\n'),
  category: [
    'pwrs-cli category - failure categories',
    '',
    'Subcommands:',
    '  category list [--project <p>]',
    '      Enumerate categories the heuristic has emitted (for --failure-category).',
    '      Pass --project to scope - categories may differ across projects.',
    '',
  ].join('\n'),
  stats: [
    'pwrs-cli stats - aggregate health digest',
    '',
    'Usage:',
    '  pwrs-cli stats [--project <p>] [--from/--to] [--failed-only]',
    '      Returns overview stats + category aggregates for the window. Defaults to all projects.',
    '',
  ].join('\n'),
  config: [
    'pwrs-cli config - local CLI configuration',
    '',
    'Subcommands:',
    '  config set server <url>     Save the Playwright Reports Server URL.',
    '  config set token <token>    Save the API token.',
    '  config get [<server|token>] Show config (token always masked).',
    '',
    'Environment overrides (always win over saved config):',
    '  PWRS_SERVER_URL, PWRS_API_TOKEN',
    '',
  ].join('\n'),
  ping: [
    'pwrs-cli ping - sanity-check the server',
    '',
    'Usage:',
    '  pwrs-cli ping    Returns { ok, server, tokenConfigured, latencyMs, status, timestamp }.',
    '',
  ].join('\n'),
  attachment: [
    'pwrs-cli attachment - fetch a server resource with Bearer auth',
    '',
    'Usage:',
    '  pwrs-cli attachment <url|/api/serve/...>            Metadata only (default).',
    '  pwrs-cli attachment <url> --inline                  Include content inline.',
    '',
    'Default emits { url, status, contentType, bytes }',
    '',
  ].join('\n'),
};

interface CommonOpts {
  project?: string;
  limit?: number;
  offset?: number;
  from?: string;
  to?: string;
  search?: string;
  tags?: string;
  passRate?: string;
  tier?: string;
  status?: string;
  failureCategory?: string;
  sort?: string;
  failedOnly?: boolean;
  withFailures?: boolean;
  reportId?: string;
  taskId?: string;
  // Authoring/feedback write flags.
  analysisFile?: string;
  summaryFile?: string;
  structuredFile?: string;
  model?: string;
  category?: string;
  comment?: string;
  fileId?: string;
  errorSignature?: string;
  excludeProject?: string;
  lastReportId?: string;
  reportCount?: number;
  firstReportAt?: string;
  lastReportAt?: string;
  force?: boolean;
  inline?: boolean;
  active?: boolean;
  resolved?: boolean;
  regressedSince?: string;
  regressedOnly?: boolean;
  includeResolved?: boolean;
  note?: string;
}

function parseCommonOpts(argv: string[]): { positionals: string[]; opts: CommonOpts } {
  const argsConfig: ParseArgsConfig = {
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      project: { type: 'string' },
      'report-id': { type: 'string' },
      'task-id': { type: 'string' },
      limit: { type: 'string' },
      offset: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      search: { type: 'string' },
      tags: { type: 'string' },
      'pass-rate': { type: 'string' },
      tier: { type: 'string' },
      status: { type: 'string' },
      'failure-category': { type: 'string' },
      sort: { type: 'string' },
      'failed-only': { type: 'boolean' },
      strategies: { type: 'string' },
      'min-tests': { type: 'string' },
      'with-failures': { type: 'boolean' },
      'analysis-file': { type: 'string' },
      'summary-file': { type: 'string' },
      'structured-file': { type: 'string' },
      model: { type: 'string' },
      category: { type: 'string' },
      comment: { type: 'string' },
      'file-id': { type: 'string' },
      'error-signature': { type: 'string' },
      'exclude-project': { type: 'string' },
      'last-report-id': { type: 'string' },
      'report-count': { type: 'string' },
      'first-report-at': { type: 'string' },
      'last-report-at': { type: 'string' },
      force: { type: 'boolean' },
      inline: { type: 'boolean' },
      active: { type: 'boolean' },
      resolved: { type: 'boolean' },
      'regressed-since': { type: 'string' },
      'regressed-only': { type: 'boolean' },
      'include-resolved': { type: 'boolean' },
      note: { type: 'string' },
      help: { type: 'boolean' },
    },
  };
  const parsed = parseArgs(argsConfig);
  const v = parsed.values;
  const parseIntOpt = (raw: unknown): number | undefined => {
    if (typeof raw !== 'string') return undefined;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const str = (raw: unknown): string | undefined => (typeof raw === 'string' ? raw : undefined);
  // PWRS_PROJECT is the default project for single-project agent setups -
  // explicit --project still wins.
  const project = str(v.project) ?? process.env.PWRS_PROJECT ?? undefined;
  return {
    positionals: parsed.positionals,
    opts: {
      project,
      limit: parseIntOpt(v.limit),
      offset:
        typeof v.offset === 'string' && Number.isFinite(Number.parseInt(v.offset, 10))
          ? Number.parseInt(v.offset, 10)
          : undefined,
      from: str(v.from),
      to: str(v.to),
      search: str(v.search),
      tags: str(v.tags),
      passRate: str(v['pass-rate']),
      tier: str(v.tier),
      status: str(v.status),
      failureCategory: str(v['failure-category']),
      sort: str(v.sort),
      failedOnly: v['failed-only'] === true,
      withFailures: v['with-failures'] === true,
      reportId: str(v['report-id']),
      taskId: str(v['task-id']),
      analysisFile: str(v['analysis-file']),
      summaryFile: str(v['summary-file']),
      structuredFile: str(v['structured-file']),
      model: str(v.model),
      category: str(v.category),
      comment: str(v.comment),
      fileId: str(v['file-id']),
      errorSignature: str(v['error-signature']),
      excludeProject: str(v['exclude-project']),
      lastReportId: str(v['last-report-id']),
      reportCount: parseIntOpt(v['report-count']),
      firstReportAt: str(v['first-report-at']),
      lastReportAt: str(v['last-report-at']),
      force: v.force === true,
      inline: v.inline === true,
      active: v.active === true,
      resolved: v.resolved === true,
      regressedSince: str(v['regressed-since']),
      regressedOnly: v['regressed-only'] === true,
      includeResolved: v['include-resolved'] === true,
      note: str(v.note),
    },
  };
}

async function dispatch(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP);
    return;
  }

  if (argv[0] === '--version' || argv[0] === '-v') {
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  if (argv[0] === 'help') {
    const requested = argv[1];
    if (!requested) {
      process.stdout.write(HELP);
      return;
    }
    const block = GROUP_HELP[requested];
    if (!block) {
      throw new Error(
        `No help for '${requested}'. Available groups: ${Object.keys(GROUP_HELP).join(', ')}.`
      );
    }
    process.stdout.write(block);
    return;
  }

  const [group, ...rest] = argv;

  if (group === 'ping') {
    await runPing();
    return;
  }

  if (group === 'attachment') {
    const { positionals, opts } = parseCommonOpts(rest);
    const [target] = positionals;
    await runAttachment(target, { inline: opts.inline === true });
    return;
  }

  if (group === 'config') {
    await runConfigCommand(rest);
    return;
  }

  if (group === 'test') {
    const [subcommand, ...subArgs] = rest;
    const { positionals, opts } = parseCommonOpts(subArgs);
    const [arg0] = positionals;
    switch (subcommand) {
      case 'find':
        await runTestFind(arg0, { project: opts.project, limit: opts.limit ?? 10 });
        return;
      case 'brief':
        await runTestBrief(arg0, { project: opts.project });
        return;
      case 'analysis':
        await runTestAnalysis(arg0, { project: opts.project });
        return;
      case 'failure-context':
        if (!opts.reportId) throw new Error('--report-id is required for failure-context');
        await runTestFailureContext(arg0, {
          project: opts.project,
          reportId: opts.reportId,
        });
        return;
      case 'analysis-prompt':
        if (!opts.reportId) throw new Error('--report-id is required for analysis-prompt');
        await runTestAnalysisPrompt(arg0, {
          project: opts.project,
          reportId: opts.reportId,
          taskId: opts.taskId,
        });
        return;
      case 'history':
        await runTestHistory(arg0, {
          project: opts.project,
          limit: opts.limit,
        });
        return;
      case 'signature-history':
        await runTestSignatureHistory(arg0, {
          reportId: opts.reportId,
          fileId: opts.fileId,
          errorSignature: opts.errorSignature,
        });
        return;
      case 'feedback-related':
        await runTestFeedbackRelated(arg0, {
          reportId: opts.reportId,
          fileId: opts.fileId,
          excludeProject: opts.excludeProject,
        });
        return;
      case 'from-file':
        await runTestFromFile(arg0, { project: opts.project, limit: opts.limit ?? 5 });
        return;
      case 'search':
        await runTestSearch({
          project: opts.project,
          tier: opts.tier,
          status: opts.status,
          failureCategory: opts.failureCategory,
          sort: opts.sort,
          search: opts.search,
          from: opts.from,
          to: opts.to,
          limit: opts.limit,
          offset: opts.offset,
          regressedOnly: opts.regressedOnly,
          regressedSince: opts.regressedSince,
        });
        return;
      case 'analysis-submit':
        if (!opts.reportId) throw new Error('--report-id is required for analysis-submit');
        if (!opts.model) throw new Error('--model is required for analysis-submit');
        await runTestAnalysisSubmit(arg0, {
          reportId: opts.reportId,
          analysisFile: opts.analysisFile,
          category: opts.category,
          model: opts.model,
          force: opts.force,
        });
        return;
      case 'feedback':
        if (!opts.comment) throw new Error('--comment is required for feedback');
        await runTestFeedbackUpsert(arg0, {
          comment: opts.comment,
          reportId: opts.reportId,
          fileId: opts.fileId,
          project: opts.project,
        });
        return;
      case 'feedback-clear':
        await runTestFeedbackClear(arg0, {
          reportId: opts.reportId,
          fileId: opts.fileId,
          project: opts.project,
        });
        return;
      default:
        throw new Error(
          `Unknown subcommand: test ${subcommand ?? ''}. Run 'pwrs-cli --help' for the list.`
        );
    }
  }

  if (group === 'report') {
    const [subcommand, ...subArgs] = rest;
    const { positionals, opts } = parseCommonOpts(subArgs);
    const [arg0, arg1] = positionals;
    switch (subcommand) {
      case 'latest':
        await runReportLatest({ project: opts.project, withFailures: opts.withFailures });
        return;
      case 'brief':
        await runReportBrief(arg0, { withFailures: opts.withFailures });
        return;
      case 'summary':
        await runReportSummary(arg0);
        return;
      case 'list':
        await runReportList({
          project: opts.project,
          search: opts.search,
          tags: opts.tags,
          from: opts.from,
          to: opts.to,
          passRate: opts.passRate,
          limit: opts.limit,
          offset: opts.offset,
        });
        return;
      case 'compare':
        await runReportCompare(arg0, arg1, { limit: opts.limit, project: opts.project });
        return;
      case 'resolve':
        await runReportResolve(arg0, { project: opts.project });
        return;
      case 'summary-submit':
        if (!opts.model) throw new Error('--model is required for summary-submit');
        await runReportSummarySubmit(arg0, {
          summaryFile: opts.summaryFile,
          structuredFile: opts.structuredFile,
          model: opts.model,
          force: opts.force,
        });
        return;
      default:
        throw new Error(
          `Unknown subcommand: report ${subcommand ?? ''}. Run 'pwrs-cli --help' for the list.`
        );
    }
  }

  if (group === 'project') {
    const [subcommand, ...subArgs] = rest;
    const { opts } = parseCommonOpts(subArgs);
    switch (subcommand) {
      case 'list':
        await runProjectList();
        return;
      case 'summary':
        await runProjectSummary({ project: opts.project });
        return;
      case 'summary-submit':
        if (!opts.model) throw new Error('--model is required for summary-submit');
        await runProjectSummarySubmit({
          project: opts.project,
          summaryFile: opts.summaryFile,
          structuredFile: opts.structuredFile,
          model: opts.model,
          lastReportId: opts.lastReportId,
          reportCount: opts.reportCount,
          firstReportAt: opts.firstReportAt,
          lastReportAt: opts.lastReportAt,
          force: opts.force,
        });
        return;
      default:
        throw new Error(
          `Unknown subcommand: project ${subcommand ?? ''}. Run 'pwrs-cli --help' for the list.`
        );
    }
  }

  if (group === 'category') {
    const [subcommand, ...subArgs] = rest;
    const { opts } = parseCommonOpts(subArgs);
    switch (subcommand) {
      case 'list':
        await runCategoryList({ project: opts.project });
        return;
      default:
        throw new Error(
          `Unknown subcommand: category ${subcommand ?? ''}. Run 'pwrs-cli --help' for the list.`
        );
    }
  }

  if (group === 'tag') {
    const [subcommand, ...subArgs] = rest;
    const { opts } = parseCommonOpts(subArgs);
    switch (subcommand) {
      case 'list':
        await runTagList({ project: opts.project });
        return;
      default:
        throw new Error(
          `Unknown subcommand: tag ${subcommand ?? ''}. Run 'pwrs-cli --help' for the list.`
        );
    }
  }

  if (group === 'cluster') {
    const [subcommand, ...subArgs] = rest;
    const { positionals, opts } = parseCommonOpts(subArgs);
    const [arg0] = positionals;
    switch (subcommand) {
      case 'list':
        await runClusterList({
          project: opts.project,
          from: opts.from,
          to: opts.to,
          limit: opts.limit,
          includeResolved: opts.includeResolved,
        });
        return;
      case 'brief':
        await runClusterBrief(arg0, { project: opts.project });
        return;
      case 'resolve':
        await runClusterResolve(arg0, { project: opts.project, note: opts.note });
        return;
      case 'reopen':
        await runClusterReopen(arg0, { project: opts.project, note: opts.note });
        return;
      default:
        throw new Error(
          `Unknown subcommand: cluster ${subcommand ?? ''}. Run 'pwrs-cli --help' for the list.`
        );
    }
  }

  if (group === 'stats') {
    const { opts } = parseCommonOpts(rest);
    await runStats({
      project: opts.project,
      from: opts.from,
      to: opts.to,
      failedOnly: opts.failedOnly,
    });
    return;
  }

  if (group === 'regression') {
    const [subcommand, ...subArgs] = rest;
    const { opts } = parseCommonOpts(subArgs);
    switch (subcommand) {
      case 'list':
        await runRegressionList({
          project: opts.project,
          active: opts.active,
          resolved: opts.resolved,
          from: opts.from,
          to: opts.to,
          sort: opts.sort,
          limit: opts.limit,
        });
        return;
      default:
        throw new Error(
          `Unknown subcommand: regression ${subcommand ?? ''}. Run 'pwrs-cli help regression' for the list.`
        );
    }
  }

  throw new Error(`Unknown command: ${group}. Run 'pwrs-cli --help' for the list.`);
}

dispatch(process.argv.slice(2)).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  let kind = 'unknown';
  let exitCode = 1;
  const extra: Record<string, unknown> = {};
  if (err instanceof CliConfigError) {
    kind = 'config';
    exitCode = 2;
  } else if (err instanceof CliHttpError) {
    kind = 'http';
    exitCode = 2;
    extra.status = err.status;
    extra.url = err.url;
  }
  process.stderr.write(`${JSON.stringify({ success: false, error: message, kind, ...extra })}\n`);
  process.exit(exitCode);
});
