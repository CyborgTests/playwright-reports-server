export interface Pagination {
  limit: number;
  offset: number;
}

export const handlePagination = <T>(items: T[], pagination?: Pagination): T[] => {
  if (!pagination) {
    return items;
  }

  return items.slice(pagination.offset, pagination.offset + pagination.limit);
};

export const parseFromRequest = (searchParams: URLSearchParams): Pagination => {
  const limitQuery = searchParams.get('limit') ?? '';
  const offsetQuery = searchParams.get('offset') ?? '';

  const limit = limitQuery ? parseInt(limitQuery, 10) : 20;
  const offset = offsetQuery ? parseInt(offsetQuery, 10) : 0;

  return { limit, offset };
};
