import type { TestWithQuarantineInfo } from '@playwright-reports/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

interface QuarantineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  test: TestWithQuarantineInfo | null;
  reason: string;
  onReasonChange: (reason: string) => void;
  onSubmit: () => void;
  isPending: boolean;
}

export function QuarantineDialog({
  open,
  onOpenChange,
  test,
  reason,
  onReasonChange,
  onSubmit,
  isPending,
}: Readonly<QuarantineDialogProps>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>
            {test?.isQuarantined ? 'Remove from quarantine' : 'Quarantine test'}
          </DialogTitle>
          <DialogDescription>
            {test?.isQuarantined
              ? 'The test will run again.'
              : 'The test will be skipped in future runs.'}
          </DialogDescription>
        </DialogHeader>
        {test && (
          <div className="space-y-4">
            <div>
              <p className="mb-4">
                <strong>Test:</strong> {test.title}
              </p>
              {!test.isQuarantined && (
                <Textarea
                  placeholder="Reason for quarantine"
                  value={reason}
                  onChange={(e) => onReasonChange(e.target.value)}
                  required
                  rows={3}
                />
              )}
              {test.isQuarantined && test.quarantineReason && (
                <div className="bg-muted p-3 rounded-lg">
                  <p className="text-sm font-semibold mb-1">Current reason:</p>
                  <p className="text-sm">{test.quarantineReason}</p>
                </div>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant={test?.isQuarantined ? 'default' : 'destructive'}
            onClick={onSubmit}
            disabled={isPending}
          >
            {isPending ? 'Saving…' : test?.isQuarantined ? 'Remove quarantine' : 'Quarantine test'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DeleteTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  test: TestWithQuarantineInfo | null;
  onSubmit: () => void;
  isPending: boolean;
}

export function DeleteTestDialog({
  open,
  onOpenChange,
  test,
  onSubmit,
  isPending,
}: Readonly<DeleteTestDialogProps>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Delete test?</DialogTitle>
          <DialogDescription>
            Permanently deletes the test and its run history. Can't be undone.
          </DialogDescription>
        </DialogHeader>
        {test && (
          <div>
            <p>
              <strong>Test:</strong> {test.title}
            </p>
            <p className="text-sm text-muted-foreground">{test.filePath}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onSubmit} disabled={isPending}>
            {isPending ? 'Deleting...' : 'Delete Test'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
