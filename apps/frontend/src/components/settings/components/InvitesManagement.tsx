import { useQueryClient } from '@tanstack/react-query';
import { Mail, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import CopyableSecretDialog from '@/components/copyable-secret-dialog';
import FormattedDate from '@/components/date-format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useConfig } from '@/hooks/useConfig';
import useMutation from '@/hooks/useMutation';
import useQuery from '@/hooks/useQuery';
import { shareLink } from '@/lib/url';

interface Invite {
  id: string;
  role: 'reader' | 'readonly';
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  revokedAt: string | null;
  createdUsernames: string[];
}

const INVITES_PATH = '/api/invites';

type InviteState = 'active' | 'revoked' | 'expired' | 'used up';

function inviteState(i: Invite): InviteState {
  if (i.revokedAt) return 'revoked';
  if (i.expiresAt && new Date(i.expiresAt).getTime() < Date.now()) return 'expired';
  if (i.maxUses != null && i.useCount >= i.maxUses) return 'used up';
  return 'active';
}

function inviteLink(code: string, serverBaseUrl?: string | null): string {
  return shareLink(`/register?invite=${encodeURIComponent(code)}`, serverBaseUrl);
}

export default function InvitesManagement() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<{ invites: Invite[] }>(INVITES_PATH);
  const { data: config } = useConfig();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [INVITES_PATH] });

  const createInvite = useMutation<{ code: string }, Record<string, unknown>>(INVITES_PATH, {
    onSuccess: (result) => {
      setCreatedCode(result.code);
      setDialogOpen(false);
      invalidate();
    },
  });
  const revokeInvite = useMutation(INVITES_PATH, { method: 'DELETE', onSuccess: invalidate });

  return (
    <>
      <Card className="mb-6 p-4">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-xl font-semibold">Invites</h2>
            </div>
            <CardDescription>
              Generate invite links for new accounts (no email required). New users start read-only;
              promote them from the Users section.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New invite
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !data?.invites.length ? (
            <p className="text-sm text-muted-foreground">No invites yet.</p>
          ) : (
            <TooltipProvider delayDuration={150}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Created</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Uses</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.invites.map((i) => {
                    const state = inviteState(i);
                    return (
                      <TableRow key={i.id} className={state !== 'active' ? 'opacity-50' : ''}>
                        <TableCell className="text-xs text-muted-foreground">
                          <FormattedDate date={i.createdAt} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {i.expiresAt ? <FormattedDate date={i.expiresAt} /> : 'never'}
                        </TableCell>
                        <TableCell>
                          {i.createdUsernames.length ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help underline decoration-dotted underline-offset-2">
                                  {i.useCount}
                                  {i.maxUses != null ? ` / ${i.maxUses}` : ''}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="font-medium">Created accounts</p>
                                <ul className="mt-1 space-y-0.5">
                                  {i.createdUsernames.map((u) => (
                                    <li key={u}>{u}</li>
                                  ))}
                                </ul>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <>
                              {i.useCount}
                              {i.maxUses != null ? ` / ${i.maxUses}` : ''}
                            </>
                          )}
                        </TableCell>
                        <TableCell>
                          {state !== 'active' ? (
                            <Badge variant="outline">{state}</Badge>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Revoke invite"
                              onClick={() =>
                                revokeInvite.mutate({ path: `${INVITES_PATH}/${i.id}` })
                              }
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>

      <CreateInviteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreate={(body) => createInvite.mutate({ body })}
      />
      <CopyableSecretDialog
        value={createdCode ? inviteLink(createdCode, config?.serverBaseUrl) : null}
        title="Invite link"
        description="Share this link. The code is shown once."
        onClose={() => setCreatedCode(null)}
      />
    </>
  );
}

function CreateInviteDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (body: Record<string, unknown>) => void;
}) {
  const [maxUses, setMaxUses] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');

  const submit = () => {
    const body: Record<string, unknown> = {};
    if (maxUses.trim()) body.maxUses = Number(maxUses);
    if (expiresInDays.trim()) {
      const days = Number(expiresInDays);
      body.expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    }
    onCreate(body);
    setMaxUses('');
    setExpiresInDays('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create invite</DialogTitle>
          <DialogDescription>
            Leave fields blank for an unlimited, non-expiring invite.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="invite-max-uses">Max uses (optional)</Label>
            <Input
              id="invite-max-uses"
              type="number"
              min={1}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="unlimited"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-expiry">Expires in days (optional)</Label>
            <Input
              id="invite-expiry"
              type="number"
              min={1}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              placeholder="never"
            />
          </div>
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
