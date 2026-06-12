import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const NOTE_MAX = 2000;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clusterName: string;
  isPending: boolean;
  onSubmit: (input: { note?: string }) => void;
}

export function MarkClusterResolvedDialog({
  open,
  onOpenChange,
  clusterName,
  isPending,
  onSubmit,
}: Readonly<Props>) {
  const [note, setNote] = useState('');

  // Reset on each open so a re-trigger doesn't carry over the previous note.
  const handleOpenChange = (next: boolean) => {
    if (next) setNote('');
    onOpenChange(next);
  };

  const handleSubmit = () => {
    onSubmit({ note: note.trim() || undefined });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Mark cluster as resolved</DialogTitle>
          <DialogDescription className="break-words">{clusterName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="cluster-resolution-note">
            Resolution note <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="cluster-resolution-note"
            placeholder="What fixed it? Link a PR / commit if applicable."
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
            rows={4}
            maxLength={NOTE_MAX}
          />
          <div className="text-right text-xs text-muted-foreground">
            {note.length} / {NOTE_MAX}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            Mark resolved
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
