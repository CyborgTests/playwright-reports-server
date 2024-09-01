import { title } from '@/app/components/primitives';
import Results from '@/app/components/results';
import FilesystemStatIcons from '@/app/components/fs-stat-icons';

export default function ResultsPage() {
  return (
    <div>
      <FilesystemStatIcons />
      <br />
      <h1 className={title()}>Results</h1>
      <br />
      <Results />
    </div>
  );
}
