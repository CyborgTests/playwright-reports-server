import type { ReportHistory } from '@playwright-reports/shared';
import { useMemo, useState } from 'react';
import DeleteReportButton from './delete-report-button';
import EditReportButton from './edit-report-button';
import ReportsTable from './reports-table';
import UploadReportButton from './upload-report-button';

interface ReportsProps {
  onChange?: () => void;
}

export default function Reports({ onChange }: Readonly<ReportsProps>) {
  const [selectedReports, setSelectedReports] = useState<ReportHistory[]>([]);

  const selectedReportIds = useMemo(
    () => selectedReports.map((r) => r.reportID),
    [selectedReports]
  );

  const onListUpdate = () => {
    setSelectedReports([]);
    onChange?.();
  };

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {selectedReports.length > 0 && (
        <span className="text-sm text-primary whitespace-nowrap">
          Selected: {selectedReports.length}
        </span>
      )}
      <UploadReportButton label="Upload" onUploadedReport={onListUpdate} />
      {selectedReports.length > 0 && (
        <EditReportButton label="Edit" reports={selectedReports} onUpdated={onListUpdate} />
      )}
      {selectedReports.length > 0 && (
        <DeleteReportButton label="Delete" reportIds={selectedReportIds} onDeleted={onListUpdate} />
      )}
    </div>
  );

  return (
    <ReportsTable
      selected={selectedReportIds}
      onSelect={setSelectedReports}
      onChange={onListUpdate}
      actions={actions}
    />
  );
}
