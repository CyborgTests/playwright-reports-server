import { Result, Report } from './types';

export const bytesToString = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
};

export const getUniqueProjectsList = (items: (Result | Report)[]): string[] => {
  return Array.from(new Set(items.map((r) => r.project).filter(Boolean)));
};
