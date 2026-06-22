import { type DomNode, normalizeDom } from '../parser/domNormalize.js';
import { type NetworkEvent, parseTraceNetwork } from '../parser/failure-extraction.js';
import { extractFromReportPayload, loadReportPayload } from '../parser/report-payload.js';
import {
  extractScreencastImages,
  type ScreencastImage,
  type ScreencastSelection,
} from '../parser/trace-screencast.js';
import {
  parseTraceSnapshots,
  richestMainFrameDom,
  type TraceSnapshots,
} from '../parser/trace-snapshot.js';
import { testDb, traceBaselineDb } from './db/index.js';

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

export async function loadFullNetworkForTest(
  reportId: string,
  testId: string
): Promise<NetworkEvent[] | null> {
  const payload = await loadReportPayload(reportId);
  if (!payload) return null;
  const slice = extractFromReportPayload(payload, testId);
  const tracePath = slice ? traceAttachmentPath(slice) : undefined;
  if (!tracePath) return null;
  return parseTraceNetwork(reportId, tracePath);
}

export async function loadTraceSnapshotsForTest(
  reportId: string,
  testId: string
): Promise<TraceSnapshots | null> {
  const payload = await loadReportPayload(reportId);
  if (!payload) return null;
  const slice = extractFromReportPayload(payload, testId);
  const tracePath = slice ? traceAttachmentPath(slice) : undefined;
  if (!tracePath) return null;
  return parseTraceSnapshots(reportId, tracePath);
}

export async function loadScreencastImagesForTest(
  reportId: string,
  testId: string,
  sel: ScreencastSelection
): Promise<ScreencastImage[]> {
  const payload = await loadReportPayload(reportId);
  if (!payload) return [];
  const slice = extractFromReportPayload(payload, testId);
  const tracePath = slice ? traceAttachmentPath(slice) : undefined;
  if (!tracePath) return [];
  return extractScreencastImages(reportId, tracePath, sel);
}

async function parseCandidateBaseline(
  reportId: string,
  testId: string
): Promise<{ network: NetworkEvent[]; dom: DomNode | null } | null> {
  const network = (await loadFullNetworkForTest(reportId, testId)) ?? [];
  const ts = await loadTraceSnapshotsForTest(reportId, testId);
  const richest = ts ? richestMainFrameDom(ts) : null;
  const dom = richest ? normalizeDom(richest) : null;
  if (network.length === 0 && !dom) return null;
  return { network, dom };
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
      return fromPersisted();
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
