#!/usr/bin/env node
import { createRequire } from 'node:module';
import { type ParseArgsConfig, parseArgs } from 'node:util';
import { CliHttpError } from './client.js';
import { runAttachment } from './commands/attachment.js';
import { runCategoryList } from './commands/category.js';
import { runClusterBrief, runClusterList } from './commands/cluster.js';
import { runConfigCommand } from './commands/config.js';
import { runPing } from './commands/ping.js';
import { runProjectList } from './commands/project.js';
import {
  runReportBrief,
  runReportCompare,
  runReportLatest,
  runReportList,
  runReportResolve,
} from './commands/report.js';
import { runStats } from './commands/stats.js';
import { runProjectSummary, runReportSummary } from './commands/summary.js';
import { runTagList } from './commands/tag.js';
import {
  runTestAnalysis,
  runTestAnalysisPrompt,
  runTestBrief,
  runTestFailureContext,
  runTestFind,
  runTestFromFile,
  runTestHistory,
  runTestSearch,
} from './commands/test.js';
import { CliConfigError } from './config.js';

const requireFromHere = createRequire(import.meta.url);
const pkg = requireFromHere('../package.json') as { version: string };

const HELP = [
  'pwrs-cli — read-only access to Playwright Reports Server data',
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
  '  cluster list [filters]                 Active failure clusters across reports',
  '  stats [filters]                        Aggregate health + trend totals for a window',
  '  ping                                   Sanity-check the server is reachable',
  '',
  'Drill-down (you already have an ID):',
  '  test find <query>                      Resolve a test name → testId',
  '  test from-file <path>[:line]           Resolve a spec file → testIds (line narrows by proximity)',
  '  test brief <testId> [--file-id …]      Everything we know about this test',
  '  test analysis <testId>                 Full persisted LLM analysis markdown',
  '  test failure-context <testId> --report-id <id>',
  '                                          Current would-be prompt + typed evidence envelope',
  '  test analysis-prompt <testId> --report-id <id>',
  '                                          Verbatim prompt from the latest completed analysis task',
  '  test history <testId> [--limit N]      Per-run history + signature rollup',
  '  test search [filters]                  Search tests by tier / status / sort / category',
  "  report latest [--with-failures]        Latest report's brief (compact by default)",
  "  report brief <reportId> [--with-failures]   Specific report's brief",
  '  report summary <reportId>              Persisted LLM failure summary for a report',
  '  report resolve <displayNumber>         Resolve a `#479` to its UUID reportId',
  '  cluster brief <clusterId>              Drill into one cluster: brief per member test',
  '  attachment <url>                       Fetch screenshot/error-context with Bearer auth',
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
  '  --strategies <signature,stack-frame,fixture,temporal>   cluster list',
  '  --min-tests <N>                        cluster list: minimum cluster size',
  '  --file-id <fileId>                     Optional for test brief/history (resolved from runs when omitted)',
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
    'pwrs-cli test — test-level drill-down',
    '',
    'Subcommands:',
    '  test find <query> [--project <p>] [--limit N]',
    '      Resolve a test name → testId (default --limit 10).',
    '  test from-file <path>[:line] [--project <p>] [--limit N]',
    '      Resolve a spec file → testIds. With :line, sorts by proximity to that line.',
    '  test brief <testId> [--file-id <fileId>] [--project <p>]',
    '      One-shot brief (signals, latest failure, LLM analysis, feedback, cluster).',
    '      --file-id and --project optional — server resolves from latest test_runs row.',
    '  test analysis <testId> [--file-id <fileId>] [--project <p>]',
    '      Full persisted LLM analysis markdown (unmodified, no regex split).',
    '  test failure-context <testId> --report-id <id> [--file-id <fileId>] [--project <p>]',
    '      The prompt the analysis queue would feed the LLM for this test right now,',
    '      plus a typed evidence envelope (codeframe, step tree, ARIA snapshot,',
    '      git/CI metadata, console + network events, history). Lets external coding',
    '      agents pull every signal we have without going through the LLM.',
    '  test analysis-prompt <testId> --report-id <id> [--file-id <fileId>] [--project <p>] [--task-id <id>]',
    '      Verbatim prompt from the latest completed test_analysis task (mirrors the',
    '      in-report "Copy prompt" button). Pass --task-id to address a specific run.',
    '  test history <testId> [--file-id <fileId>] [--project <p>] [--limit N]',
    '      Per-run history + signatureGroups rollup. Default --limit 20, max 50.',
    '  test search [filters]',
    '      Open-ended search. Supports --tier, --status, --failure-category, --sort slowest,',
    '      --search, --from/--to, --limit (default 20, max 100), --offset.',
    '',
  ].join('\n'),
  report: [
    'pwrs-cli report — report-level drill-down',
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
    '      Diff two reports — buckets: newlyFailed, fixed, stillFailing, flakyToPass, etc.',
    '      Accepts UUID reportIds and the keywords `latest` / `prev`.',
    '',
  ].join('\n'),
  cluster: [
    'pwrs-cli cluster — failure-cluster drill-down',
    '',
    'Subcommands:',
    '  cluster list [--project <p>] [--from/--to] [--strategies signature,stack-frame,fixture,temporal]',
    '              [--min-tests N] [--limit N]',
    '      Active failure clusters across reports (default --limit 10).',
    '  cluster brief <clusterId> [--project <p>]',
    '      Drill into one cluster: brief per member test (capped at 50 members).',
    '',
  ].join('\n'),
  project: [
    'pwrs-cli project — project-level info',
    '',
    'Subcommands:',
    '  project list',
    '      List projects known to the server.',
    '  project summary [--project <p>]',
    '      Persisted LLM project health summary. Omit --project (or pass `all`) for cross-project.',
    '',
  ].join('\n'),
  tag: [
    'pwrs-cli tag — report tags',
    '',
    'Subcommands:',
    '  tag list [--project <p>]    List report tags (pairs with `report list --tags <a,b>`).',
    '',
  ].join('\n'),
  category: [
    'pwrs-cli category — failure categories',
    '',
    'Subcommands:',
    '  category list [--project <p>]',
    '      Enumerate categories the heuristic has emitted (for --failure-category).',
    '      Pass --project to scope — categories may differ across projects.',
    '',
  ].join('\n'),
  stats: [
    'pwrs-cli stats — aggregate health digest',
    '',
    'Usage:',
    '  pwrs-cli stats [--project <p>] [--from/--to] [--failed-only]',
    '      Returns overview stats + category aggregates for the window. Defaults to all projects.',
    '',
  ].join('\n'),
  config: [
    'pwrs-cli config — local CLI configuration',
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
    'pwrs-cli ping — sanity-check the server',
    '',
    'Usage:',
    '  pwrs-cli ping    Returns { ok, server, tokenConfigured, latencyMs, status, timestamp }.',
    '',
  ].join('\n'),
  attachment: [
    'pwrs-cli attachment — fetch a server resource with Bearer auth',
    '',
    'Usage:',
    '  pwrs-cli attachment <url|/api/serve/...>',
    '      Fetch a `screenshotUrl` / `errorContextUrl` / `reportUrl` listed in a `test brief`.',
    '      Accepts absolute URLs or server-relative paths (resolved against PWRS_SERVER_URL).',
    '      Emits { url, status, contentType, bytes, encoding, content }. Text content (markdown,',
    '      JSON, etc.) is utf8; binary content (PNG, etc.) is base64.',
    '',
  ].join('\n'),
};

interface CommonOpts {
  project?: string;
  fileId?: string;
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
  strategies?: string;
  minTests?: number;
  withFailures?: boolean;
  reportId?: string;
  taskId?: string;
}

function parseCommonOpts(argv: string[]): { positionals: string[]; opts: CommonOpts } {
  const argsConfig: ParseArgsConfig = {
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      project: { type: 'string' },
      'file-id': { type: 'string' },
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
  // PWRS_PROJECT is the default project for single-project agent setups —
  // explicit --project still wins.
  const project = str(v.project) ?? process.env.PWRS_PROJECT ?? undefined;
  return {
    positionals: parsed.positionals,
    opts: {
      project,
      fileId: str(v['file-id']),
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
      strategies: str(v.strategies),
      minTests: parseIntOpt(v['min-tests']),
      withFailures: v['with-failures'] === true,
      reportId: str(v['report-id']),
      taskId: str(v['task-id']),
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
    const [target] = rest;
    await runAttachment(target);
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
        await runTestBrief(arg0, { project: opts.project, fileId: opts.fileId });
        return;
      case 'analysis':
        await runTestAnalysis(arg0, { project: opts.project, fileId: opts.fileId });
        return;
      case 'failure-context':
        if (!opts.reportId) throw new Error('--report-id is required for failure-context');
        await runTestFailureContext(arg0, {
          project: opts.project,
          fileId: opts.fileId,
          reportId: opts.reportId,
        });
        return;
      case 'analysis-prompt':
        if (!opts.reportId) throw new Error('--report-id is required for analysis-prompt');
        await runTestAnalysisPrompt(arg0, {
          project: opts.project,
          fileId: opts.fileId,
          reportId: opts.reportId,
          taskId: opts.taskId,
        });
        return;
      case 'history':
        await runTestHistory(arg0, {
          project: opts.project,
          fileId: opts.fileId,
          limit: opts.limit,
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
          minTests: opts.minTests,
          strategies: opts.strategies,
          limit: opts.limit,
        });
        return;
      case 'brief':
        await runClusterBrief(arg0, { project: opts.project });
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
