'use server';

import { readResults } from '@/app/lib/data';
import ResultsHandler from '@/app/components/results-handler';

export default async function Results() {
  const results = await readResults();

  return <ResultsHandler results={results} />;
}
