import '@/app/styles/globals.css';
import { Metadata, Viewport } from 'next';
import Link from 'next/link';
import clsx from 'clsx';
import { Toaster } from 'sonner';

import { Providers } from './providers';

import { siteConfig } from '@/app/config/site';
import { fontSans } from '@/app/config/fonts';
import { Navbar } from '@/app/components/navbar';
import { Aside } from '@/app/components/aside';
import { service } from '@/app/lib/service';

export async function generateMetadata(): Promise<Metadata> {
  const config = await service.getConfig();

  return {
    title: {
      default: siteConfig.name,
      template: `%s - ${siteConfig.name}`,
    },
    description: siteConfig.description,
    icons: {
      icon: config?.faviconPath ? `/api/static${config.faviconPath}` : '/favicon.ico',
    },
  };
}

export async function generateViewport(): Promise<Viewport> {
  return {
    themeColor: [
      { media: '(prefers-color-scheme: light)', color: 'white' },
      { media: '(prefers-color-scheme: dark)', color: 'black' },
    ],
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html suppressHydrationWarning lang="en">
      <head>
        <link href="https://fonts.googleapis.com" rel="preconnect" />
        <link crossOrigin="anonymous" href="https://fonts.gstatic.com" rel="preconnect" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={clsx('min-h-screen bg-background font-sans antialiased', fontSans.variable)}>
        <Providers attribute="class" defaultTheme="dark">
          <div className="relative flex flex-col h-screen">
            <Navbar />
            <div className="flex flex-1">
              <Aside />
              <main className="w-[calc(100%-4rem)] px-6 py-12">
                {children}
                <Toaster closeButton richColors visibleToasts={3} />
              </main>
            </div>
            <footer className="w-full flex items-center justify-center py-4 bg-[#F9FAFB] dark:bg-background border-t border-gray-200 dark:border-gray-800">
              <Link
                className="flex items-center gap-1 text-current"
                href="https://github.com/CyborgTests/playwright-reports-server"
                target="_blank"
                title="Source code link"
              >
                <span className="text-default-600">Powered by</span>
                <p className="text-primary">CyborgTests</p>
              </Link>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
