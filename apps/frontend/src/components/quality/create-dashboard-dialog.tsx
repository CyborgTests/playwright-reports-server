import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface CreateDashboardDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; isDefault: boolean; stalenessDays: number }) => Promise<void>;
}

export function CreateDashboardDialog({ open, onClose, onCreate }: CreateDashboardDialogProps) {
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [stalenessDays, setStalenessDays] = useState(7);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setIsDefault(false);
    setStalenessDays(7);
    setSubmitting(false);
    setError(null);
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), isDefault, stalenessDays });
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create dashboard');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New quality dashboard</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dash-name">Name</Label>
            <Input
              id="dash-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. Smoke"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Must be unique. A URL-safe slug is derived from the name automatically.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dash-stale">Staleness threshold (days)</Label>
            <Input
              id="dash-stale"
              type="number"
              min={0}
              max={365}
              value={stalenessDays}
              onChange={(e) => setStalenessDays(Number(e.target.value) || 0)}
            />
          </div>
          <div className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={isDefault}
              onCheckedChange={(v) => setIsDefault(v === true)}
              id="dash-default"
            />
            <div>
              <Label htmlFor="dash-default" className="cursor-pointer">
                Show on home page
              </Label>
              <p className="text-xs text-muted-foreground">
                Multiple dashboards can be pinned to `/` - reorder them later from the home page.
              </p>
            </div>
          </div>
          {error && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || submitting}>
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
