'use client';

import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { defaultProjectName } from '../lib/constants';

import ProjectSelect from './project-select';

import ReportsTable from '@/app/components/reports-table';
import { title } from '@/app/components/primitives';

interface ReportsProps {
  onChange: () => void;
}

export default function Reports({ onChange }: ReportsProps) {
  const [refreshId, setRefreshId] = useState<string>(uuidv4());
  const [project, setProject] = useState(defaultProjectName);

  const updateView = () => {
    onChange?.();
    setRefreshId(uuidv4());
  };

  return (
    <>
      <div className="flex flex-row justify-between">
        <h1 className={title()}>Reports</h1>
        <ProjectSelect refreshId={refreshId} onSelect={setProject} />
      </div>
      <br />
      <ReportsTable project={project} onChange={updateView} />
    </>
  );
}
