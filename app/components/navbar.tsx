import {
  Navbar as NextUINavbar,
  NavbarContent,
  NavbarMenu,
  NavbarMenuToggle,
  NavbarBrand,
  NavbarItem,
  NavbarMenuItem,
} from '@heroui/navbar';
import Image from 'next/image';
import { Link } from '@heroui/link';
import NextLink from 'next/link';

import { subtitle } from './primitives';

import { defaultConfig, getConfigWithError } from '@/app/lib/actions';
import { HeaderLinks } from '@/app/components/header-links';
import { siteConfig } from '@/app/config/site';
import { ThemeSwitch } from '@/app/components/theme-switch';
import { SiteWhiteLabelConfig } from '@/app/types';

export const Navbar: React.FC = async () => {
  const { result: config }: { result?: SiteWhiteLabelConfig } = await getConfigWithError();

  const isCustomLogo = config?.logoPath !== defaultConfig.logoPath;
  const isCustomTitle = config?.title !== defaultConfig.title;

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
            <Image
              unoptimized
              alt="Logo"
              className={`min-w-10 dark:invert ${isCustomLogo ? 'max-w-10' : ''}`}
              height="31"
              src={`/api/static${config?.logoPath}`}
              width="174"
            />
          </NextLink>
          {isCustomTitle && <h1 className={subtitle()}>{config?.title}</h1>}
        </NavbarBrand>
      </NavbarContent>

      <NavbarContent className="hidden sm:flex basis-1/5 sm:basis-full" justify="end">
        <NavbarItem className="hidden sm:flex gap-4">
          {config ? <HeaderLinks config={config} /> : null}
          <ThemeSwitch />
        </NavbarItem>
      </NavbarContent>

      {/* mobile view fallback */}
      <NavbarContent className="sm:hidden basis-1 md:min-w-fit min-w-full sm:justify-center justify-end pb-14">
        {config && <HeaderLinks config={config} />}
        <ThemeSwitch />
        {!!siteConfig.navMenuItems.length && <NavbarMenuToggle />}
      </NavbarContent>

      <NavbarMenu>
        <div className="mx-4 mt-2 flex flex-col gap-2">
          {siteConfig.navMenuItems.map((item, index) => (
            <NavbarMenuItem key={`${item.label}-${index}`}>
              <Link
                color={index === 2 ? 'primary' : index === siteConfig.navMenuItems.length - 1 ? 'danger' : 'foreground'}
                href="#"
                size="lg"
              >
                {item.label}
              </Link>
            </NavbarMenuItem>
          ))}
        </div>
      </NavbarMenu>
    </NextUINavbar>
  );
};
