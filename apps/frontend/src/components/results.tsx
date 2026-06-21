import { getUniqueProjectsList, type Result } from '@playwright-reports/shared';
import { useMemo, useState } from 'react';
import DeleteResultsButton from './delete-results-button';
import GenerateReportButton from './generate-report-button';
import ResultsTable from './results-table';
import UploadResultsButton from './upload-results-button';

interface ResultsProps {
  onChange?: () => void;
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

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {selectedResults.length > 0 && (
        <span className="text-sm text-primary whitespace-nowrap">
          Selected: {selectedResults.length}
        </span>
      )}
      <GenerateReportButton
        projects={projects}
        results={selectedResults}
        onGeneratedReport={onListUpdate}
      />
      <UploadResultsButton label="Upload" onUploadedResult={onListUpdate} />
      <DeleteResultsButton
        label="Delete"
        resultIds={selectedResultIds}
        onDeletedResult={onListUpdate}
      />
    </div>
  );

  return (
    <ResultsTable
      selected={selectedResultIds}
      onDeleted={onListUpdate}
      onSelect={setSelectedResults}
      actions={actions}
    />
  );
}
