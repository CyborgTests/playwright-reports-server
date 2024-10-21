'use client';

import { Select, SelectItem, SharedSelection } from '@nextui-org/react';

import useQuery from '../hooks/useQuery';
import { defaultProjectName } from '../lib/constants';

import ErrorMessage from './error-message';

interface ProjectSelectProps {
  onSelect: (project: string) => void;
  refreshId?: string;
  entity: 'result' | 'report';
}

export default function ProjectSelect({ refreshId, onSelect, entity }: Readonly<ProjectSelectProps>) {
  const {
    data: projects,
    error,
    isLoading,
  } = useQuery<string[]>(`/api/${entity}/projects`, {
    dependencies: [refreshId],
  });

  const items = [defaultProjectName, ...(projects ?? [])];

  const onChange = (keys: SharedSelection) => {
    if (keys === defaultProjectName.toString()) {
      onSelect?.(defaultProjectName);

      return;
    }

    if (!keys.currentKey) {
      return;
    }

    onSelect?.(keys.currentKey);
  };

  return (
    <>
      {error && <ErrorMessage message={error.message ?? ''} />}
      <Select
        disallowEmptySelection
        className="pt-1 w-full"
        defaultSelectedKeys={[defaultProjectName]}
        isDisabled={items.length <= 1}
        isLoading={isLoading}
        label="project"
        onSelectionChange={onChange}
      >
        {items.map((project) => (
          <SelectItem key={project}>{project}</SelectItem>
        ))}
      </Select>
    </>
  );
}
