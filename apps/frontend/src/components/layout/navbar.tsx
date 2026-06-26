import type { OAuthProviderId, OAuthPublicProvider } from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Gauge, KeyRound, Link2, ListTodo, LogOut, Menu, UserRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { HeaderLinks } from '@/components/header-links';
import { ReportIcon, ResultIcon, SettingsIcon, TrendIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { siteConfig as defaultConfig } from '@/config/site';
import { useAuth } from '@/hooks/useAuth';
import { useConfig } from '@/hooks/useConfig';
import { useOAuthIdentities, useOAuthProviders, useUnlinkProvider } from '@/hooks/useOAuth';
import { changePassword, oauthStartUrl, signOut } from '@/lib/auth';
import { withBase } from '@/lib/url';
import { cn } from '@/lib/utils';
import { ThemeSwitch } from './theme-switch';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { label: 'Overview', href: '/', icon: Gauge },
  { label: 'Analytics', href: '/analytics', icon: TrendIcon },
  { label: 'Reports', href: '/reports', icon: ReportIcon },
  { label: 'Results', href: '/results', icon: ResultIcon },
  { label: 'Settings', href: '/settings', icon: SettingsIcon },
  { label: 'LLM Queue', href: '/llm-queue', icon: ListTodo },
];

export function Navbar() {
  const location = useLocation();
  const { data: config, isLoading } = useConfig();

  const isCustomLogo = !!config?.logoPath && config.logoPath !== defaultConfig.logoPath;
  const isCustomTitle = !!config?.title && config.title !== defaultConfig.title;
  const invertLogoOnDark = config?.logoInvertOnDark !== false;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        {/* Logo */}
        <Link to="/" className="mr-4 md:mr-6 flex items-center space-x-2 min-w-0">
          {isLoading ? (
            <Skeleton className="h-8 w-[174px]" />
          ) : (
            <>
              <img
                alt="Logo"
                {...(isCustomLogo ? {} : { width: 174, height: 32 })}
                className={cn(
                  'h-8 shrink-0',
                  isCustomLogo ? 'w-auto max-w-[240px] object-contain object-left' : 'w-[174px]',
                  invertLogoOnDark && 'dark:invert'
                )}
                src={withBase(`/api/static${config?.logoPath ?? defaultConfig.logoPath}`)}
              />
              {isCustomTitle && config?.title && (
                <span className="font-display font-bold text-lg truncate max-w-[160px]">
                  {config.title}
                </span>
              )}
            </>
          )}
        </Link>

        {/* Desktop navigation - hidden below md */}
        <nav className="hidden md:flex items-center space-x-1 text-sm font-medium">
          {navItems.map((item) => {
            const isActive = location.pathname === item.href;
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  'inline-flex items-center gap-2 px-4 py-2 rounded-lg transition-colors',
                  'hover:bg-accent hover:text-accent-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right side */}
        <div className="ml-auto flex items-center space-x-2 md:space-x-3">
          {config?.headerLinks?.length ? (
            <div className="hidden md:flex items-center gap-2">
              <HeaderLinks config={config} size={20} />
            </div>
          ) : null}
          <ThemeSwitch />

          <AccountMenu />

          {/* Mobile hamburger - shown below md */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild className="md:hidden">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open navigation menu"
                className="h-9 w-9"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {navItems.map((item) => {
                const isActive = location.pathname === item.href;
                const Icon = item.icon;
                return (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link
                      to={item.href}
                      className={cn(
                        'flex items-center gap-2 w-full',
                        isActive && 'bg-accent text-accent-foreground'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  </DropdownMenuItem>
                );
              })}
              {config?.headerLinks?.length ? (
                <>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5 flex flex-col gap-1.5">
                    <HeaderLinks config={config} size={18} withTitle />
                  </div>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

function AccountMenu() {
  const session = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pwOpen, setPwOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const { data: providers = [] } = useOAuthProviders();
  const { data: identities } = useOAuthIdentities();
  const user = session.data?.user;

  if (!user?.id) return null;

  const handleSignOut = async () => {
    await signOut();
    await queryClient.invalidateQueries({ queryKey: ['auth-session'] });
    navigate('/login', { replace: true });
  };

  const hasPassword = identities?.hasPassword ?? true;
  const ssoAvailable = providers.length > 0;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Account" className="h-9 w-9">
            <UserRound className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium truncate">{user.username}</p>
            <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
          </div>
          <DropdownMenuSeparator />
          {hasPassword && (
            <DropdownMenuItem onSelect={() => setPwOpen(true)}>
              <KeyRound className="mr-2 h-4 w-4" />
              <span>Change password</span>
            </DropdownMenuItem>
          )}
          {ssoAvailable && (
            <DropdownMenuItem onSelect={() => setAccountsOpen(true)}>
              <Link2 className="mr-2 h-4 w-4" />
              <span>Connected accounts</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>Sign out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} username={user.username ?? ''} />
      <ConnectedAccountsDialog
        open={accountsOpen}
        onOpenChange={setAccountsOpen}
        providers={providers}
      />
    </>
  );
}

function ConnectedAccountsDialog({
  open,
  onOpenChange,
  providers,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  providers: OAuthPublicProvider[];
}) {
  const location = useLocation();
  const { data: identities, isLoading } = useOAuthIdentities();
  const unlink = useUnlinkProvider();

  const linkedFor = (id: OAuthProviderId) => identities?.identities.find((i) => i.provider === id);

  const handleUnlink = (id: OAuthProviderId) => {
    unlink.mutate(
      { path: `/api/auth/oauth/${id}/unlink` },
      { onSuccess: () => toast.success('Account unlinked') }
    );
  };

  const startLink = (id: OAuthProviderId) => {
    const callbackUrl = location.pathname + location.search;
    window.location.href = oauthStartUrl(id, { intent: 'link', callbackUrl });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connected accounts</DialogTitle>
          <DialogDescription>
            Link a provider to sign in with it, or unlink one you no longer use.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Spinner />
        ) : (
          <div className="space-y-3">
            {providers.map((p) => {
              const linked = linkedFor(p.id);
              return (
                <div key={p.id} className="flex items-center justify-between rounded-md border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{p.label}</p>
                    {linked ? (
                      <p className="text-xs text-muted-foreground truncate">
                        {linked.email ?? linked.displayName ?? 'Connected'}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Not connected</p>
                    )}
                  </div>
                  {linked ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={unlink.isPending}
                      onClick={() => handleUnlink(p.id)}
                    >
                      Unlink
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => startLink(p.id)}>
                      Connect
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangePasswordDialog({
  open,
  onOpenChange,
  username,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  username: string;
}) {
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setCurrentPassword('');
    setNewPassword('');
    setError('');
    setSubmitting(false);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    setSubmitting(true);
    setError('');
    const result = await changePassword(username, currentPassword, newPassword);
    if (result.ok) {
      await queryClient.invalidateQueries({ queryKey: ['auth-session'] });
      toast.success('Password changed');
      onOpenChange(false);
      reset();
    } else {
      setError(result.error ?? 'Could not change password');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Enter your current password and choose a new one. Other sessions will be signed out.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="change-new-password">New password</Label>
              <Input
                id="change-new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                className={error ? 'border-destructive' : ''}
              />
              {error && <p className="text-sm text-destructive animate-fade-in">{error}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Spinner className="mr-2 h-4 w-4" />}
              {submitting ? 'Changing…' : 'Change password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
