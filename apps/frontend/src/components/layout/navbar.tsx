import { ListTodo, Menu } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { HeaderLinks } from '@/components/header-links';
import { ReportIcon, ResultIcon, SettingsIcon, TrendIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { siteConfig as defaultConfig } from '@/config/site';
import { useConfig } from '@/hooks/useConfig';
import { withBase } from '@/lib/url';
import { cn } from '@/lib/utils';
import { ThemeSwitch } from './theme-switch';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const baseNavItems: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: TrendIcon },
  { label: 'Reports', href: '/reports', icon: ReportIcon },
  { label: 'Results', href: '/results', icon: ResultIcon },
  { label: 'Settings', href: '/settings', icon: SettingsIcon },
];

const llmQueueNavItem: NavItem = { label: 'LLM Queue', href: '/llm-queue', icon: ListTodo };

export function Navbar() {
  const location = useLocation();
  const { data: config, isLoading } = useConfig();

  const isLlmConfigured = !!(config?.llm?.baseUrl && config?.llm?.apiKey);
  const navItems = isLlmConfigured ? [...baseNavItems, llmQueueNavItem] : baseNavItems;

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
                className={cn(
                  'h-8 shrink-0',
                  isCustomLogo ? 'w-auto' : 'w-[174px]',
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

        {/* Desktop navigation — hidden below md */}
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

          {/* Mobile hamburger — shown below md */}
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
                  <div className="px-2 py-1.5 flex items-center gap-2 flex-wrap">
                    <HeaderLinks config={config} size={18} />
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
