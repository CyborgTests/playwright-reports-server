'use client';

import { useState } from 'react';

import ResultsTable from '@/app/components/results-table';
import { type Result } from '@/app/lib/data';
import { title } from '@/app/components/primitives';
import GenerateReportButton from '@/app/components/generate-report-button';
import DeleteResultsButton from '@/app/components/delete-results-button';
import { useApiToken } from '@/app/providers/ApiTokenProvider';

interface ResultsHandlerProps {
  results: Result[];
}

export default function ResultsHandler({ results }: ResultsHandlerProps) {
  const { apiToken } = useApiToken();

  const [selectedResults, setSelectedResults] = useState<string[]>([]);

  return (
    <>
      <div className="flex justify-between">
        <h1 className={title()}>Results</h1>
        <div className="flex gap-2">
          <GenerateReportButton resultIds={selectedResults} token={apiToken} onGenerated={setSelectedResults} />
          <DeleteResultsButton resultIds={selectedResults} token={apiToken} />
        </div>
      </div>
      <br />
      <ResultsTable results={results} selected={selectedResults} token={apiToken} onSelect={setSelectedResults} />
    </>
  );
}
