import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import useMutation from '../hooks/useMutation';
import { invalidateCache } from '../lib/query-cache';
import { DeleteIcon } from './icons';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { Spinner } from './ui/spinner';

interface DeleteProjectButtonProps {
  resultIds: string[];
  onDeletedResult?: () => void;
  label?: string;
}

export default function DeleteResultsButton({
  resultIds,
  onDeletedResult,
  label,
}: Readonly<DeleteProjectButtonProps>) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const {
    mutate: deleteResult,
    isPending,
    error,
  } = useMutation('/api/result/delete', {
    method: 'DELETE',
    onSuccess: () => {
      invalidateCache(queryClient, {
        queryKeys: ['/api/info'],
        predicate: '/api/result',
      });
      toast.success(`result${resultIds.length ? '' : 's'} deleted`);
      setOpen(false);
      onDeletedResult?.();
    },
  });

  const handleDelete = async () => {
    if (!resultIds?.length) {
      return;
    }

    deleteResult({ body: { resultsIds: resultIds } });
  };

  error && toast.error(error.message);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className={label ? '' : 'p-0 min-w-10'}
          disabled={!resultIds?.length}
          size={label ? 'default' : 'icon'}
          title="Delete results"
          variant="ghost"
        >
          {label || <DeleteIcon />}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Are you sure?</DialogTitle>
          <DialogDescription>This will permanently delete your results files.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={isPending} onClick={handleDelete}>
            {isPending && <Spinner className="mr-2 h-4 w-4" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
