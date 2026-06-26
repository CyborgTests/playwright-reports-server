import { useState } from 'react';
import { toast } from 'sonner';
import useMutation from '@/hooks/useMutation';
import type { ClusterResolutionRequest } from './types';

export function useClusterResolution(clusterId: string, project: string, onChange: () => void) {
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);

  const markMutation = useMutation<{ success: boolean }, ClusterResolutionRequest>(
    `/api/analytics/failure-clusters/${clusterId}/resolve`,
    {
      method: 'POST',
      onSuccess: () => {
        toast.success('Cluster marked as resolved');
        setResolveDialogOpen(false);
        onChange();
      },
    }
  );

  const reopenMutation = useMutation<{ success: boolean }, ClusterResolutionRequest>(
    `/api/analytics/failure-clusters/${clusterId}/reopen`,
    {
      method: 'POST',
      onSuccess: () => {
        toast.success('Cluster re-opened');
        onChange();
      },
    }
  );

  const submitResolve = (input: { note?: string }) => {
    const body: ClusterResolutionRequest = { project };
    if (input.note) body.note = input.note;
    markMutation.mutate({ body });
  };

  return {
    resolveDialogOpen,
    setResolveDialogOpen,
    submitResolve,
    reopen: () => reopenMutation.mutate({ body: { project } }),
    markPending: markMutation.isPending,
    reopenPending: reopenMutation.isPending,
  };
}
