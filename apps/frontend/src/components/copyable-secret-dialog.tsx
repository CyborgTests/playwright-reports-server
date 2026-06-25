import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

// Open while `value` is non-null.
export default function CopyableSecretDialog({
  value,
  title,
  description,
  onClose,
}: {
  value: string | null;
  title: string;
  description: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={value !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input readOnly value={value ?? ''} className="font-mono text-xs" />
          <Button
            variant="outline"
            size="icon"
            aria-label="Copy to clipboard"
            onClick={() => {
              if (value) {
                navigator.clipboard.writeText(value);
                toast.success('Copied to clipboard');
              }
            }}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
