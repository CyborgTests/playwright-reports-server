export const withQueryParams = (url: string, params: Record<string, string>): string => {
  // `new URL(url, origin)` ignores the base when `url` is already absolute, so
  // one path covers both absolute URLs and same-origin relative paths.
  const urlObj = new URL(url, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      urlObj.searchParams.set(key, value);
    }
  }
  return urlObj.toString();
};
