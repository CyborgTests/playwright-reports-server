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

interface DeleteReportButtonProps {
  reportId?: string;
  reportIds?: string[];
  onDeleted: () => void;
  label?: string;
}

export default function DeleteReportButton({
  reportId,
  reportIds,
  onDeleted,
  label,
}: Readonly<DeleteReportButtonProps>) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ids = reportIds ?? (reportId ? [reportId] : []);
  const count = ids.length;
  const {
    mutate: deleteReport,
    isPending,
    error,
  } = useMutation('/api/report/delete', {
    method: 'DELETE',
    onSuccess: () => {
      invalidateCache(queryClient, {
        queryKeys: ['/api/info'],
        predicate: '/api/report',
      });
      toast.success(count === 1 ? `report deleted` : `${count} reports deleted`);
      setOpen(false);
      onDeleted?.();
    },
  });

  const handleDelete = async () => {
    if (!ids.length) {
      return;
    }
    deleteReport({ body: { reportsIds: ids } });
  };

  error && toast.error(error.message);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className={label ? '' : 'p-0 min-w-10'}
          disabled={!count}
          size={label ? 'default' : 'icon'}
          title={count > 1 ? 'Delete reports' : 'Delete report'}
          variant="ghost"
        >
          {label || <DeleteIcon />}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Are you sure?</DialogTitle>
          <DialogDescription>
            {count > 1
              ? `This will permanently delete ${count} reports.`
              : 'This will permanently delete your report.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={isPending} onClick={handleDelete}>
            {isPending && <Spinner className="mr-2 h-4 w-4" />}
            {count > 1 ? `Delete ${count} reports` : 'Delete Report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
