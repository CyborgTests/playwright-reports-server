'use server';

import { readResults } from '@/app/lib/data';
import ResultsTable from '@/app/components/results-table';

export default async function Results() {
  const results = await readResults();

  return <ResultsTable results={results} />;
}
