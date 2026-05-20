#!/usr/bin/env node
import { type ParseArgsConfig, parseArgs } from 'node:util';
import { CliHttpError } from './client.js';
import { runClusterList } from './commands/cluster.js';
import { runConfigCommand } from './commands/config.js';
import { runProjectList } from './commands/project.js';
import {
  runReportBrief,
  runReportCompare,
  runReportLatest,
  runReportList,
} from './commands/report.js';
import { runStats } from './commands/stats.js';
import { runTagList } from './commands/tag.js';
import { runTestBrief, runTestFind, runTestFromFile, runTestSearch } from './commands/test.js';
import { CliConfigError } from './config.js';

const HELP = [
  'pwrs-cli — read-only access to Playwright Reports Server data',
  '',
  'Usage:',
  '  pwrs-cli <command> [args] [options]',
  '',
  'Discovery:',
  '  project list                           List projects known to the server',
  '  tag list [--project <p>]               List report tags',
  '  report list [filters]                  List reports (filters below)',
  '  report compare <a> <b> [--limit N]     Diff two reports (newly failed / fixed / …)',
  '  cluster list [filters]                 Active failure clusters across reports',
  '  stats [filters]                        Aggregate health + trend totals for a window',
  '',
  'Drill-down (you already have an ID):',
  '  test find <query>                      Resolve a test name → testId',
  '  test from-file <path>[:line]           Resolve a spec file → testIds',
  '  test brief <testId> --file-id …        Everything we know about this test',
  '  test search [filters]                  Search tests by tier / status / sort / category',
  "  report latest                          Latest report's brief (failed tests + clusters)",
  "  report brief <reportId>                Specific report's brief",
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
  '  --failure-category <c>                 test search',
  '  --sort slowest                         test search ordering',
  '  --failed-only                          stats: scope to runs with failures',
  '  --strategies <signature,stack-frame,fixture,temporal>   cluster list',
  '  --min-tests <N>                        cluster list: minimum cluster size',
  '  --file-id <fileId>                     Required for test brief',
  '  --help                                 Show this message',
  '',
  'Environment:',
  '  PWRS_SERVER_URL                         Server URL (overrides saved config)',
  '  PWRS_API_TOKEN                          API token (overrides saved config)',
  '',
].join('\n');

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
}

function parseCommonOpts(argv: string[]): { positionals: string[]; opts: CommonOpts } {
  const argsConfig: ParseArgsConfig = {
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      project: { type: 'string' },
      'file-id': { type: 'string' },
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
  return {
    positionals: parsed.positionals,
    opts: {
      project: str(v.project),
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
    },
  };
}

async function dispatch(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    process.stdout.write(HELP);
    return;
  }

  const [group, ...rest] = argv;

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
        await runReportLatest({ project: opts.project });
        return;
      case 'brief':
        await runReportBrief(arg0);
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
        await runReportCompare(arg0, arg1, { limit: opts.limit });
        return;
      default:
        throw new Error(
          `Unknown subcommand: report ${subcommand ?? ''}. Run 'pwrs-cli --help' for the list.`
        );
    }
  }

  if (group === 'project') {
    const [subcommand] = rest;
    switch (subcommand) {
      case 'list':
        await runProjectList();
        return;
      default:
        throw new Error(
          `Unknown subcommand: project ${subcommand ?? ''}. Run 'pwrs-cli --help' for the list.`
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
    const { opts } = parseCommonOpts(subArgs);
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
  if (err instanceof CliConfigError || err instanceof CliHttpError) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(2);
  }
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
