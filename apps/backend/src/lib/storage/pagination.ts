export interface Pagination {
  limit: number;
  offset: number;
}

const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 100;

const parseQueryInt = (raw: string | null, fallback: number, min: number): number => {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
};

export const parseFromRequest = (searchParams: URLSearchParams): Pagination => {
  const limit = Math.min(parseQueryInt(searchParams.get('limit'), LIMIT_DEFAULT, 1), LIMIT_MAX);
  const offset = parseQueryInt(searchParams.get('offset'), 0, 0);

  return { limit, offset };
};
