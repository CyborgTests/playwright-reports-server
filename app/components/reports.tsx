'use client';

import { useState } from 'react';

import ReportsTable from '@/app/components/reports-table';
import { title } from '@/app/components/primitives';
import DeleteReportButton from '@/app/components/delete-report-button';
import { type ReportHistory } from '@/app/lib/storage';

interface ReportsProps {
  onChange: () => void;
}

export default function Reports({ onChange }: ReportsProps) {
  const [selectedReports, setSelectedReports] = useState<ReportHistory[]>([]);

  const selectedReportIds = selectedReports.map((r) => r.reportID);

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
            <div className="text-sm pr-3 text-primary">Reports selected: {selectedReports.length}</div>
          )}
          <DeleteReportButton label="Delete" reportIds={selectedReportIds} onDeleted={onListUpdate} />
        </div>
      </div>
      <br />
      <ReportsTable
        selected={selectedReportIds}
        onChange={onChange}
        onDeleted={onListUpdate}
        onSelect={setSelectedReports}
      />
    </>
  );
}
