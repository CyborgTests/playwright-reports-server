'use client';

import { Select, SelectItem, SharedSelection } from '@nextui-org/react';

import useQuery from '../hooks/useQuery';
import { defaultProjectName } from '../lib/constants';

import ErrorMessage from './error-message';

interface ProjectSelectProps {
  onSelect: (project: string) => void;
  refreshId?: string;
}

export default function ProjectSelect({ refreshId, onSelect }: Readonly<ProjectSelectProps>) {
  const { data: projects, error, isLoading } = useQuery<string[]>('/api/project/list', { dependencies: [refreshId] });

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
        className="pt-1 max-w-[30%]"
        defaultSelectedKeys={[defaultProjectName]}
        isDisabled={items.length <= 1}
        isLoading={isLoading}
        label="project"
        size="lg"
        onSelectionChange={onChange}
      >
        {items.map((project) => (
          <SelectItem key={project}>{project}</SelectItem>
        ))}
      </Select>
    </>
  );
}
