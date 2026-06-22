import type { LlmConcurrencyGroup } from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LLM_GROUPS_PATH, useLlmGroups } from '@/hooks/useLlmGroups';
import useMutation from '@/hooks/useMutation';
import { errorMessage } from '@/lib/api';

function clampLimit(raw: string): number {
  return Math.min(100, Math.max(1, Number.parseInt(raw, 10) || 1));
}

export default function LLMConcurrencyGroups({ disabled }: Readonly<{ disabled: boolean }>) {
  const queryClient = useQueryClient();
  const { data: groupsData } = useLlmGroups();
  const groups = groupsData ?? [];

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLimit, setNewLimit] = useState(1);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [LLM_GROUPS_PATH] });
  const createGroup = useMutation<LlmConcurrencyGroup, Record<string, unknown>>(LLM_GROUPS_PATH, {
    method: 'POST',
    silent: true,
    onSuccess: invalidate,
  });
  const updateGroup = useMutation<LlmConcurrencyGroup, Record<string, unknown>>(LLM_GROUPS_PATH, {
    method: 'PATCH',
    silent: true,
    onSuccess: invalidate,
  });
  const deleteGroup = useMutation(LLM_GROUPS_PATH, {
    method: 'DELETE',
    silent: true,
    onSuccess: invalidate,
  });

  const submitNew = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error('Group name is required');
      return;
    }
    try {
      await createGroup.mutateAsync({ body: { name, concurrencyLimit: newLimit } });
      toast.success(`Group "${name}" created`);
      setNewName('');
      setNewLimit(1);
      setAdding(false);
    } catch (error) {
      toast.error(`Create failed: ${errorMessage(error)}`);
    }
  };

  const saveGroup = async (group: LlmConcurrencyGroup, name: string, limit: number) => {
    if (name.trim() === group.name && limit === group.concurrencyLimit) return;
    try {
      await updateGroup.mutateAsync({
        path: `${LLM_GROUPS_PATH}/${group.id}`,
        body: { name: name.trim(), concurrencyLimit: limit },
      });
    } catch (error) {
      toast.error(`Update failed: ${errorMessage(error)}`);
      invalidate();
    }
  };

  const removeGroup = async (group: LlmConcurrencyGroup) => {
    try {
      await deleteGroup.mutateAsync({ path: `${LLM_GROUPS_PATH}/${group.id}` });
      toast.success(`Group "${group.name}" deleted`);
    } catch (error) {
      toast.error(`Delete failed: ${errorMessage(error)}`);
    }
  };

  return (
    <div
      className={`mb-4 space-y-3 rounded-md border bg-muted/30 p-3 ${disabled ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Concurrency groups</p>
          <p className="text-xs text-muted-foreground mt-1">
            Limit concurrent requests across models that share a rate limit or GPU. Members ignore
            their own "parallel requests" and use the group's limit instead.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={adding} onClick={() => setAdding(true)}>
          Add group
        </Button>
      </div>

      {groups.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground">No groups yet.</p>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <GroupRow key={g.id} group={g} onSave={saveGroup} onDelete={removeGroup} />
          ))}
        </div>
      )}

      {adding && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border bg-background p-2">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Name</span>
            <Input
              className="h-8 w-40"
              value={newName}
              autoFocus
              placeholder="e.g. local-gpu"
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Limit</span>
            <Input
              className="h-8 w-20"
              type="number"
              min={1}
              max={100}
              value={newLimit}
              onChange={(e) => setNewLimit(clampLimit(e.target.value))}
            />
          </div>
          <Button size="sm" onClick={submitNew}>
            Add
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAdding(false);
              setNewName('');
              setNewLimit(1);
            }}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function GroupRow({
  group,
  onSave,
  onDelete,
}: Readonly<{
  group: LlmConcurrencyGroup;
  onSave: (group: LlmConcurrencyGroup, name: string, limit: number) => void;
  onDelete: (group: LlmConcurrencyGroup) => void;
}>) {
  const [name, setName] = useState(group.name);
  const [limit, setLimit] = useState(group.concurrencyLimit);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2">
      <Input
        className="h-8 w-40"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => onSave(group, name, limit)}
      />
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">limit</span>
        <Input
          className="h-8 w-20"
          type="number"
          min={1}
          max={100}
          value={limit}
          onChange={(e) => setLimit(clampLimit(e.target.value))}
          onBlur={() => onSave(group, name, limit)}
        />
      </div>
      <span className="text-xs text-muted-foreground">
        {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
      </span>
      <Button size="sm" variant="destructive" className="ml-auto" onClick={() => onDelete(group)}>
        Delete
      </Button>
    </div>
  );
}
