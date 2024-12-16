import { Result, Report } from './types';

export const bytesToString = (bytes: number): string => {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

export const getUniqueProjectsList = (items: (Result | Report)[]): string[] => {
  return Array.from(new Set(items.map((r) => r.project).filter(Boolean)));
};
