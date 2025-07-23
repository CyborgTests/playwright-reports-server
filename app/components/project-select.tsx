'use client';

import { Select, SelectItem, SharedSelection } from '@heroui/react';
import { toast } from 'sonner';

import useQuery from '../hooks/useQuery';
import { defaultProjectName } from '../lib/constants';

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

  error && toast.error(error.message);

  return (
    <Select
      className="w-36 min-w-36 bg-transparent"
      defaultSelectedKeys={[defaultProjectName]}
      isDisabled={items.length <= 1}
      isLoading={isLoading}
      label="Project"
      labelPlacement="outside"
      variant="bordered"
      onSelectionChange={onChange}
    >
      {items.map((project) => (
        <SelectItem key={project}>{project}</SelectItem>
      ))}
    </Select>
  );
}
