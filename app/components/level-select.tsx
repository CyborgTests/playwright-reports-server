'use client';

import { Select, SelectItem, SharedSelection } from '@heroui/react';
import { toast } from 'sonner';

import useQuery from '../hooks/useQuery';
import { defaultLevelName } from '../lib/constants';

interface LevelSelectProps {
  onSelect: (level: string) => void;
  refreshId?: string;
  entity: 'result' | 'report';
}

export default function LevelSelect({ refreshId, onSelect, entity }: Readonly<LevelSelectProps>) {
  const {
    data: levels,
    error,
    isLoading,
  } = useQuery<string[]>(`/api/${entity}/levels`, {
    dependencies: [refreshId],
  });

  const items = [defaultLevelName, ...(levels ?? [])];

  const onChange = (keys: SharedSelection) => {
    if (keys === defaultLevelName.toString()) {
      onSelect?.(defaultLevelName);

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
      defaultSelectedKeys={[defaultLevelName]}
      isDisabled={items.length <= 1}
      isLoading={isLoading}
      label="Level"
      labelPlacement="outside"
      variant="bordered"
      onSelectionChange={onChange}
    >
      {items.map((level) => (
        <SelectItem key={level}>{level}</SelectItem>
      ))}
    </Select>
  );
}
