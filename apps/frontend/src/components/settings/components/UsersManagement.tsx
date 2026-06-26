import type { PaginationResponse } from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Trash2, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import CopyableSecretDialog from '@/components/copyable-secret-dialog';
import PaginatedControls from '@/components/paginated-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
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
import { useConfig } from '@/hooks/useConfig';
import useMutation from '@/hooks/useMutation';
import useQuery from '@/hooks/useQuery';
import { shareLink } from '@/lib/url';

type Role = 'admin' | 'reader' | 'readonly';

interface User {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
}

const USERS_PATH = '/api/users';
const PAGE_SIZE = 25;

export default function UsersManagement({ currentUserId }: { currentUserId: string | null }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery<PaginationResponse<User>>(
    `${USERS_PATH}?page=${page}&limit=${PAGE_SIZE}`,
    { queryKey: [USERS_PATH, page] }
  );
  const { data: config } = useConfig();
  const [resetToken, setResetToken] = useState<string | null>(null);

  const users = data?.data;
  const totalPages = data?.pagination.totalPages ?? 1;
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [USERS_PATH] });

  const patchUser = useMutation(USERS_PATH, { method: 'PATCH', onSuccess: invalidate });
  const deleteUser = useMutation(USERS_PATH, { method: 'DELETE', onSuccess: invalidate });
  const resetUser = useMutation<{ resetToken: string }>(`${USERS_PATH}/reset`, {
    onSuccess: (result) => setResetToken(result.resetToken),
  });

  return (
    <>
      <Card className="mb-6 p-4">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-xl font-semibold">Users</h2>
            </div>
            <CardDescription>
              Manage accounts and roles. New users join via invites. The last enabled admin can't be
              disabled or removed.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !users?.length ? (
            <p className="text-sm text-muted-foreground">No users yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.username}
                      {u.id === currentUserId && (
                        <Badge variant="secondary" className="ml-2">
                          you
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={u.role}
                        onValueChange={(role) =>
                          patchUser.mutate({ path: `${USERS_PATH}/${u.id}`, body: { role } })
                        }
                      >
                        <SelectTrigger className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="readonly">readonly</SelectItem>
                          <SelectItem value="reader">reader</SelectItem>
                          <SelectItem value="admin">admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={!u.disabled}
                        onCheckedChange={(enabled) =>
                          patchUser.mutate({
                            path: `${USERS_PATH}/${u.id}`,
                            body: { disabled: !enabled },
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Issue reset link"
                        onClick={() => resetUser.mutate({ path: `${USERS_PATH}/${u.id}/reset` })}
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete user"
                        onClick={() => deleteUser.mutate({ path: `${USERS_PATH}/${u.id}` })}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
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

      <CopyableSecretDialog
        value={
          resetToken
            ? shareLink(`/login?reset=${encodeURIComponent(resetToken)}`, config?.serverBaseUrl)
            : null
        }
        title="Password reset link"
        description="Share this one-time link with the user out-of-band. Shown once."
        onClose={() => setResetToken(null)}
      />
    </>
  );
}
