import type { PaginationResponse } from '@playwright-reports/shared';
import { keepPreviousData, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import CopyableSecretDialog from '@/components/copyable-secret-dialog';
import FormattedDate from '@/components/date-format';
import PaginatedControls from '@/components/paginated-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import useMutation from '@/hooks/useMutation';
import useQuery from '@/hooks/useQuery';

type KeyType = 'reporter' | 'cli' | 'share';

interface ApiKey {
  id: string;
  label: string;
  type: string;
  service: boolean;
  ownerUserId: string | null;
  ownerUsername: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const KEYS_PATH = '/api/keys';
const PAGE_SIZE = 10;

export default function ApiKeysManagement({ canManageAllKeys }: { canManageAllKeys: boolean }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showInactive, setShowInactive] = useState(false);
  const { data, isLoading } = useQuery<PaginationResponse<ApiKey>>(
    `${KEYS_PATH}?page=${page}&limit=${PAGE_SIZE}${showInactive ? '&includeInactive=true' : ''}`,
    { queryKey: [KEYS_PATH, page, showInactive], placeholderData: keepPreviousData }
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const keys = data?.data;
  const totalPages = data?.pagination.totalPages ?? 1;
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [KEYS_PATH] });

  const createKey = useMutation<{ key: string }, Record<string, unknown>>(KEYS_PATH, {
    onSuccess: (result) => {
      setCreatedKey(result.key);
      setDialogOpen(false);
      invalidate();
    },
  });
  const revokeKey = useMutation(KEYS_PATH, { method: 'DELETE', onSuccess: invalidate });

  return (
    <>
      <Card className="mb-6 p-4">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <KeyRound className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-xl font-semibold">API Keys</h2>
            </div>
            <CardDescription>
              Keys for the reporter (upload) and CLI/agents (cli). Shown once at creation.
              {canManageAllKeys && ' As an admin you can see and revoke every user’s keys.'}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="keys-show-revoked"
                checked={showInactive}
                onCheckedChange={setShowInactive}
              />
              <Label
                htmlFor="keys-show-revoked"
                className="text-sm font-normal text-muted-foreground"
              >
                Show revoked
              </Label>
            </div>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> New key
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !keys?.length ? (
            <p className="text-sm text-muted-foreground">No API keys yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  {canManageAllKeys && <TableHead>Owner</TableHead>}
                  <TableHead>Type</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id} className={k.revokedAt ? 'opacity-50' : ''}>
                    <TableCell className="font-medium">
                      {k.label}
                      {k.service && (
                        <Badge variant="secondary" className="ml-2">
                          service
                        </Badge>
                      )}
                    </TableCell>
                    {canManageAllKeys && (
                      <TableCell className="text-sm text-muted-foreground">
                        {k.service ? '-' : (k.ownerUsername ?? 'unknown')}
                      </TableCell>
                    )}
                    <TableCell>{k.type}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {k.lastUsedAt ? <FormattedDate date={k.lastUsedAt} /> : 'never'}
                    </TableCell>
                    <TableCell>
                      {k.revokedAt ? (
                        <Badge variant="outline">revoked</Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Revoke key"
                          onClick={() => revokeKey.mutate({ path: `${KEYS_PATH}/${k.id}` })}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <PaginatedControls
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            className="mt-4"
          />
        </CardContent>
      </Card>

      <CreateKeyDialog
        open={dialogOpen}
        canManageAllKeys={canManageAllKeys}
        onOpenChange={setDialogOpen}
        onCreate={(body) => createKey.mutate({ body })}
      />
      <CopyableSecretDialog
        value={createdKey}
        title="Copy your API key"
        description="This is the only time the full key is shown. Store it now."
        onClose={() => setCreatedKey(null)}
      />
    </>
  );
}

function CreateKeyDialog({
  open,
  canManageAllKeys,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  canManageAllKeys: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (body: Record<string, unknown>) => void;
}) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<KeyType>('cli');
  const [service, setService] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');

  const submit = () => {
    if (!label.trim()) {
      toast.error('A label is required');
      return;
    }
    onCreate({
      label: label.trim(),
      type,
      service: canManageAllKeys ? service : undefined,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    });
    setLabel('');
    setType('cli');
    setService(false);
    setExpiresAt('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create API key</DialogTitle>
          <DialogDescription>The secret is shown once, right after creation.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="key-label">Label</Label>
            <Input id="key-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="key-type">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as KeyType)}>
              <SelectTrigger id="key-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reporter">Reporter (upload &amp; generate reports)</SelectItem>
                <SelectItem value="cli">CLI / agent (read &amp; manage data)</SelectItem>
                {canManageAllKeys && (
                  <SelectItem value="share">Share link (read-only public report links)</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="key-expires">Expires (optional)</Label>
            <Input
              id="key-expires"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          {canManageAllKeys && (
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                id="key-service"
                checked={service}
                onCheckedChange={(v) => setService(v === true)}
              />
              <Label htmlFor="key-service" className="font-normal">
                Service key (no owner - survives user deletion; for CI)
              </Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
