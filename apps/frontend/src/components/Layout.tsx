import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useConfig } from '@/hooks/useConfig';
import { withBase } from '@/lib/url';
import { cn } from '@/lib/utils';
import { Navbar } from './layout/navbar';

interface LayoutProps {
  children?: React.ReactNode;
}

function setFaviconHref(href: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = href;
}

export function Layout({ children }: LayoutProps) {
  const { data: config } = useConfig();

  useEffect(() => {
    if (config?.title) {
      document.title = config.title;
    }
  }, [config?.title]);

  useEffect(() => {
    if (!config?.faviconPath) return;
    const href = config.faviconPath.startsWith('http')
      ? config.faviconPath
      : withBase(`/api/static${config.faviconPath}`);
    setFaviconHref(href);
  }, [config?.faviconPath]);

  return (
    <div className="min-h-screen bg-background font-sans overflow-x-clip">
      <div className="flex min-h-screen flex-col">
        <Navbar />

        <main className={cn('flex-1', 'container', 'py-6 md:py-8', 'min-w-0')}>
          {children || <Outlet />}
        </main>

        <footer className="border-t border-border/40 py-4">
          <div className="container flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <span>Powered by</span>
            <a
              href="https://www.cyborgtest.com/"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary hover:underline"
            >
              CyborgTests
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
