import ReportsTable from '@/app/components/reports-table';
import { title } from '@/app/components/primitives';

interface ReportsProps {
  onChange: () => void;
}

export default function Reports({ onChange }: ReportsProps) {
  return (
    <>
      <div className="flex flex-row justify-between">
        <h1 className={title()}>Reports</h1>
      </div>
      <br />
      <ReportsTable onChange={onChange} />
    </>
  );
}
