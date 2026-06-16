import { getUniqueProjectsList, type Result } from '@playwright-reports/shared';
import { useMemo, useState } from 'react';
import DeleteResultsButton from './delete-results-button';
import GenerateReportButton from './generate-report-button';
import { title } from './primitives';
import ResultsTable from './results-table';
import UploadResultsButton from './upload-results-button';

interface ResultsProps {
  onChange: () => void;
}

export default function Results({ onChange }: Readonly<ResultsProps>) {
  const [selectedResults, setSelectedResults] = useState<Result[]>([]);

  const selectedResultIds = useMemo(
    () => selectedResults.map((r) => r.resultID),
    [selectedResults]
  );

  const projects = useMemo(() => getUniqueProjectsList(selectedResults), [selectedResults]);

  const onListUpdate = () => {
    setSelectedResults([]);
    onChange?.();
  };

  return (
    <>
      <div className="flex w-full">
        <div className="w-1/3">
          <h1 className={title()}>Results</h1>
        </div>
        <div className="flex gap-2 w-2/3 flex-wrap justify-end items-center ml-2">
          {selectedResults.length > 0 && (
            <div className="text-sm pr-3 text-primary">
              Results selected: {selectedResults.length}
            </div>
          )}
          <GenerateReportButton
            projects={projects}
            results={selectedResults}
            onGeneratedReport={onListUpdate}
          />
          <UploadResultsButton onUploadedResult={onListUpdate} />
          <DeleteResultsButton
            label="Delete"
            resultIds={selectedResultIds}
            onDeletedResult={onListUpdate}
          />
        </div>
      </div>
      <br />
      <ResultsTable
        selected={selectedResultIds}
        onDeleted={onListUpdate}
        onSelect={setSelectedResults}
      />
    </>
  );
}
