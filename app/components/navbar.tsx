'use client';
import {
  Navbar as NextUINavbar,
  NavbarContent,
  NavbarMenu,
  NavbarMenuToggle,
  NavbarBrand,
  NavbarItem,
} from '@heroui/navbar';
import Image from 'next/image';
import NextLink from 'next/link';
import { toast } from 'sonner';
import { Skeleton } from '@heroui/skeleton';

import { subtitle } from './primitives';

import { defaultConfig } from '@/app/lib/config';
import { HeaderLinks } from '@/app/components/header-links';
import { ThemeSwitch } from '@/app/components/theme-switch';
import { SiteWhiteLabelConfig } from '@/app/types';
import useQuery from '@/app/hooks/useQuery';

export const Navbar: React.FC = () => {
  const { data: config, error, isLoading } = useQuery<SiteWhiteLabelConfig>('/api/config');

  const isCustomLogo = config?.logoPath !== defaultConfig.logoPath;
  const isCustomTitle = config?.title !== defaultConfig.title;

  if (error) {
    toast.error(error.message);
  }

  return (
    <NextUINavbar
      classNames={{
        wrapper:
          'flex flex-row flex-wrap bg-[#F9FAFB] dark:bg-background border-b border-gray-200 dark:border-gray-800 max-w-full',
      }}
      height="3.75rem"
      maxWidth="xl"
      position="sticky"
    >
      <NavbarContent className="basis-1/5 sm:basis-full" justify="start">
        <NavbarBrand as="li" className="gap-3 max-w-fit">
          <NextLink className="flex justify-start items-center gap-1" href="/">
            <Skeleton className="rounded-lg" isLoaded={!isLoading && !!config}>
              {config && (
                <Image
                  unoptimized
                  alt="Logo"
                  className={`min-w-10 dark:invert ${isCustomLogo ? 'max-w-10' : ''}`}
                  height="31"
                  src={`/api/static${config?.logoPath}`}
                  width="174"
                />
              )}
            </Skeleton>
          </NextLink>

          {isCustomTitle && <h1 className={subtitle()}>{config?.title}</h1>}
        </NavbarBrand>
      </NavbarContent>

      <NavbarContent className="hidden sm:flex basis-1/5 sm:basis-full" justify="end">
        <NavbarItem className="hidden sm:flex gap-4">
          {config && !isLoading ? (
            <HeaderLinks config={config} />
          ) : (
            <Skeleton className="sm:flex basis-1/5 sm:basis-full" />
          )}
          <ThemeSwitch />
        </NavbarItem>
      </NavbarContent>

      {/* mobile view fallback */}
      <NavbarContent className="sm:hidden basis-1 !justify-end">
        <ThemeSwitch />
        {!!config && <NavbarMenuToggle />}
      </NavbarContent>

      <NavbarMenu>
        <div className="mx-4 mt-2 flex flex-col gap-2">
          {config && !isLoading ? <HeaderLinks withTitle config={config} /> : <Skeleton className="w-20" />}
        </div>
      </NavbarMenu>
    </NextUINavbar>
  );
};
