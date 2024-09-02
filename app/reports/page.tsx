import { title } from '@/app/components/primitives';
import Reports from '@/app/components/reports';
import FilesystemStatIcons from '@/app/components/fs-stat-icons';

export default function ReportsPage() {
  return (
    <div>
      <FilesystemStatIcons />
      <br />
      <h1 className={title()}>Reports</h1>
      <br />
      <Reports />
    </div>
  );
}
