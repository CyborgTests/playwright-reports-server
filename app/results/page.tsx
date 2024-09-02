import Results from '@/app/components/results';
import FilesystemStatIcons from '@/app/components/fs-stat-icons';

export default function ResultsPage() {
  return (
    <div>
      <FilesystemStatIcons />
      <br />
      <Results />
    </div>
  );
}
