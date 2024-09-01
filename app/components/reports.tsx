'use server';

import { readReports } from '@/app/lib/data';
import ReportsTable from '@/app/components/reports-table';

export default async function Reports() {
  const reports = await readReports();

  return <ReportsTable reports={reports} />;
}
