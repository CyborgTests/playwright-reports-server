import { type DomNode, normalizeDom } from '../parser/domNormalize.js';
import { type NetworkEvent, parseTraceNetwork } from '../parser/failure-extraction.js';
import { extractFromReportPayload, loadReportPayload } from '../parser/report-payload.js';
import {
  parseTrace,
  richestMainFrameDom,
  type ScreencastFrame,
  type TraceSnapshots,
} from '../parser/trace-snapshot.js';
import { openTraceZip, type TraceZip } from '../parser/trace-zip.js';
import { reportDb, testDb, traceBaselineDb } from './db/index.js';

export interface BaselineEvidence {
  network: NetworkEvent[];
  dom: DomNode | null;
  label: string;
}

function traceAttachmentPath(slice: {
  attachments?: Array<{ name?: string; path?: string }>;
}): string | undefined {
  return slice.attachments?.find((a) => a.name === 'trace' && a.path)?.path;
}

export interface TraceArtifacts {
  network: NetworkEvent[];
  snapshots: TraceSnapshots | null;
  screencastFrames: ScreencastFrame[];
  zip: TraceZip;
}

export async function loadTraceArtifacts(
  reportId: string,
  testId: string
): Promise<TraceArtifacts | null> {
  const storagePath = reportDb.getStoragePath(reportId);
  const payload = await loadReportPayload(reportId, storagePath);
  if (!payload) return null;
  const slice = extractFromReportPayload(payload, testId);
  const tracePath = slice ? traceAttachmentPath(slice) : undefined;
  if (!tracePath) return null;
  const zip = await openTraceZip(reportId, tracePath, storagePath);
  if (!zip) return null;
  const parsed = await parseTrace(zip);
  return {
    network: await parseTraceNetwork(zip),
    snapshots: parsed.snapshots,
    screencastFrames: parsed.screencastFrames,
    zip,
  };
}

async function parseCandidateBaseline(
  reportId: string,
  testId: string
): Promise<{ network: NetworkEvent[]; dom: DomNode | null } | null> {
  const trace = await loadTraceArtifacts(reportId, testId);
  if (!trace) return null;
  const richest = trace.snapshots ? richestMainFrameDom(trace.snapshots) : null;
  const dom = richest ? normalizeDom(richest) : null;
  if (trace.network.length === 0 && !dom) return null;
  return { network: trace.network, dom };
}

function baselineLabel(outcome: string, createdAt: string): string {
  const kind = outcome === 'expected' || outcome === 'passed' ? 'passing' : outcome;
  return `${kind} run (${createdAt.slice(0, 10)})`;
}

export async function resolveBaseline(ctx: {
  testId: string;
  fileId: string;
  project: string;
  currentReportId: string;
}): Promise<BaselineEvidence | null> {
  const { testId, fileId, project, currentReportId } = ctx;
  const persisted = traceBaselineDb.get(testId, fileId, project);

  const fromPersisted = (): BaselineEvidence | null => {
    if (!persisted) return null;
    let network: NetworkEvent[] = [];
    let dom: DomNode | null = null;
    try {
      network = JSON.parse(persisted.network) as NetworkEvent[];
    } catch {
      network = [];
    }
    if (persisted.dom) {
      try {
        dom = JSON.parse(persisted.dom) as DomNode;
      } catch {
        dom = null;
      }
    }
    if (network.length === 0 && !dom) return null;
    return {
      network,
      dom,
      label: baselineLabel(persisted.sourceOutcome, persisted.sourceCreatedAt),
    };
  };

  const candidates = testDb.getBaselineCandidates(testId, fileId, project, currentReportId);

  for (const cand of candidates) {
    if (persisted && cand.reportId === persisted.sourceReportId) {
      const evidence = fromPersisted();
      if (evidence) return evidence;
    }
    const parsed = await parseCandidateBaseline(cand.reportId, testId);
    if (parsed) {
      traceBaselineDb.upsert({
        testId,
        fileId,
        project,
        sourceReportId: cand.reportId,
        sourceCreatedAt: cand.createdAt,
        sourceOutcome: cand.outcome,
        network: JSON.stringify(parsed.network),
        dom: parsed.dom ? JSON.stringify(parsed.dom) : null,
      });
      return {
        network: parsed.network,
        dom: parsed.dom,
        label: baselineLabel(cand.outcome, cand.createdAt),
      };
    }
  }

  return fromPersisted();
}
