import { type Report } from '@/app/lib/storage';

export const sortReportsByCreatedDate = (reports: Report[]) => {
  return reports.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
};
