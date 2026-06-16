import type { ReportHistory } from '@playwright-reports/shared';
import { useMemo, useState } from 'react';
import DeleteReportButton from './delete-report-button';
import EditReportButton from './edit-report-button';
import { title } from './primitives';
import ReportsTable from './reports-table';
import UploadReportButton from './upload-report-button';

interface ReportsProps {
  onChange: () => void;
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

  return (
    <>
      <div className="flex w-full">
        <div className="w-1/3">
          <h1 className={title()}>Reports</h1>
        </div>
        <div className="flex gap-2 w-2/3 flex-wrap justify-end items-center ml-2">
          {selectedReports.length > 0 && (
            <div className="text-sm pr-3 text-primary">
              Reports selected: {selectedReports.length}
            </div>
          )}
          <UploadReportButton onUploadedReport={onListUpdate} />
          {selectedReports.length > 0 && (
            <EditReportButton label="Edit" reports={selectedReports} onUpdated={onListUpdate} />
          )}
          {selectedReports.length > 0 && (
            <DeleteReportButton
              label="Delete"
              reportIds={selectedReportIds}
              onDeleted={onListUpdate}
            />
          )}
        </div>
      </div>
      <br />
      <ReportsTable
        selected={selectedReportIds}
        onSelect={setSelectedReports}
        onChange={onListUpdate}
      />
    </>
  );
}
