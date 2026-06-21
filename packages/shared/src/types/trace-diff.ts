export type NetworkDiffKind =
  | 'now-failing' // succeeded in baseline, fails now (strongest app-change signal)
  | 'status-changed' // same endpoint, different status class (2xx/3xx/4xx/5xx)
  | 'added' // endpoint hit now, not in baseline
  | 'removed'; // endpoint hit in baseline, not now

export interface NetworkDiffEntry {
  kind: NetworkDiffKind;
  method: string;
  url: string;
  baselineStatus?: number;
  currentStatus?: number;
  failureText?: string;
}

export interface NetworkDiff {
  entries: NetworkDiffEntry[];
  baselineCount: number;
  currentCount: number;
  omitted: number;
}

export type DomChangeKind =
  | 'added' // element present now, not in the comparison tree
  | 'removed' // element present in the comparison tree, not now
  | 'text-changed' // same element identity, different visible text
  | 'attr-changed'; // same element identity, different semantic attribute

export interface DomDiffEntry {
  kind: DomChangeKind;
  path: string;
  detail?: string;
}

export interface DomDiff {
  entries: DomDiffEntry[];
  textAdded: string[];
  textRemoved: string[];
  omitted: number;
  textAddedOmitted?: number;
  textRemovedOmitted?: number;
}
