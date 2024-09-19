export const bytesToString = (bytes: number): string => {
  return `${(bytes / 1000 / 1000).toFixed(2)} MB`;
};
