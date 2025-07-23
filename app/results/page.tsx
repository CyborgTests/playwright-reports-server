'use client';

import PageLayout from '@/app/components/page-layout';
import Results from '@/app/components/results';

export default function ResultsPage() {
  return <PageLayout render={({ onUpdate }) => <Results onChange={onUpdate} />} />;
}
