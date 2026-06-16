// get unique list of projects from items with project property
export function getUniqueProjectsList(items: { project: string }[]): string[] {
  const projects = new Set<string>();
  items.forEach((item) => {
    if (item.project) {
      projects.add(item.project);
    }
  });
  return Array.from(projects).sort();
}

// format bytes to human readable string
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = Math.max(decimals, 0);
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${Number.parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Format duration in milliseconds to human readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;

  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function formatRelativeTime(input: string | number): string {
  const then = typeof input === 'number' ? input : new Date(input).getTime();
  if (Number.isNaN(then)) return '';

  const diffMs = Date.now() - then;
  if (diffMs <= 0) return 'just now';

  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;

  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;

  return `${Math.floor(days / 365)}y ago`;
}

// match the SQLite timestamp format ("YYYY-MM-DD HH:MM:SS[.fff]")
const SQLITE_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/;

// convert SQLite timestamp (UTC, no tz suffix) to an ISO string.
export function sqliteTimestampToIso(ts: string): string | null {
  if (!SQLITE_TIMESTAMP_RE.test(ts)) return null;
  return new Date(`${ts.replace(' ', 'T')}Z`).toISOString();
}

// parse timestamp to ms
export function parseSqliteTimestamp(ts: string): number {
  return new Date(sqliteTimestampToIso(ts) ?? ts).getTime();
}
