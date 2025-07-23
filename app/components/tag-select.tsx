'use client';

import { Select, SelectItem, SharedSelection } from '@heroui/react';
import { toast } from 'sonner';

import useQuery from '../hooks/useQuery';

interface TagSelectProps {
  onSelect?: (tags: string[]) => void;
  refreshId?: string;
  entity: 'result' | 'report';
  project?: string;
}

export default function TagSelect({ refreshId, onSelect, entity, project }: Readonly<TagSelectProps>) {
  const {
    data: tags,
    error,
    isLoading,
  } = useQuery<string[]>(`/api/${entity}/tags${project ? `?project=${encodeURIComponent(project)}` : ''}`, {
    dependencies: [refreshId, project],
  });

  const onChange = (keys: SharedSelection) => {
    if (typeof keys === 'string') {
      return;
    }

    const selectedTags = Array.from(keys) as string[];

    onSelect?.(selectedTags);
  };

  error && toast.error(error.message);

  return (
    <Select
      className="w-36 min-w-36 bg-transparent"
      isDisabled={!tags?.length}
      isLoading={isLoading}
      label="Tags"
      labelPlacement="outside"
      placeholder="Select tags"
      selectionMode="multiple"
      variant="bordered"
      onSelectionChange={onChange}
    >
      {tags?.map((tag) => <SelectItem key={tag}>{tag}</SelectItem>) ?? []}
    </Select>
  );
}
