import '@/app/styles/globals.css';
import { Metadata, Viewport } from 'next';
import Link from 'next/link';
import clsx from 'clsx';
import { Toaster } from 'sonner';

import { Providers } from './providers';

import { siteConfig } from '@/app/config/site';
import { getConfigWithError } from '@/app/lib/actions';
import { fontSans } from '@/app/config/fonts';
import { Navbar } from '@/app/components/navbar';

export async function generateMetadata(): Promise<Metadata> {
  const { result: config } = await getConfigWithError();

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
      <head />
      <body className={clsx('min-h-screen bg-background font-sans antialiased', fontSans.variable)}>
        <Providers attribute="class" defaultTheme="dark">
          <div className="relative flex flex-col h-screen">
            <Navbar />
            <main className="container mx-auto max-w-7xl pt-16 px-6 flex-grow">
              {children}
              <Toaster closeButton richColors visibleToasts={3} />
            </main>
            <footer className="w-full flex items-center justify-center py-4 bg-[#F9FAFB] dark:bg-background">
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
