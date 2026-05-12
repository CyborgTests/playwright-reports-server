import { Link, useLocation } from 'react-router-dom';
import { HeaderLinks } from '@/components/header-links';
import { ReportIcon, ResultIcon, SettingsIcon, TrendIcon } from '@/components/icons';
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

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: TrendIcon },
  { label: 'Reports', href: '/reports', icon: ReportIcon },
  { label: 'Results', href: '/results', icon: ResultIcon },
  { label: 'Settings', href: '/settings', icon: SettingsIcon },
];

export function Navbar() {
  const location = useLocation();
  const { data: config, isLoading } = useConfig();

  const isCustomLogo = config?.logoPath !== defaultConfig.logoPath;
  const isCustomTitle = config?.title && config?.title !== defaultConfig.title;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        {/* Logo */}
        <Link to="/" className="mr-6 flex items-center space-x-2">
          {isLoading ? (
            <Skeleton className="h-8 w-[174px]" />
          ) : (
            <>
              <img
                alt="Logo"
                className={cn('h-8', isCustomLogo ? 'w-auto' : 'w-[174px]', 'dark:invert')}
                src={withBase(`/api/static${config?.logoPath ?? defaultConfig.logoPath}`)}
              />
              {isCustomTitle && config?.title && (
                <span className="font-display font-bold text-lg">{config.title}</span>
              )}
            </>
          )}
        </Link>

        {/* Navigation Tabs */}
        <nav className="flex items-center space-x-1 text-sm font-medium">
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
        <div className="ml-auto flex items-center space-x-3">
          {config?.headerLinks?.length ? (
            <div className="flex items-center gap-2">
              <HeaderLinks config={config} size={20} />
            </div>
          ) : null}
          <ThemeSwitch />
        </div>
      </div>
    </header>
  );
}
