import {
  Navbar as NextUINavbar,
  NavbarContent,
  NavbarMenu,
  NavbarMenuToggle,
  NavbarBrand,
  NavbarItem,
  NavbarMenuItem,
} from '@nextui-org/navbar';
import NextImage from 'next/image';
import { Link } from '@nextui-org/link';
import { link as linkStyles } from '@nextui-org/theme';
import { Image } from '@nextui-org/react';
import NextLink from 'next/link';
import clsx from 'clsx';

import { HeaderLinks } from '@/app/components/header-links';
import { siteConfig } from '@/app/config/site';
import { ThemeSwitch } from '@/app/components/theme-switch';
import { SiteWhiteLabelConfig } from '@/app/types';
interface NavbarProps {
  config: SiteWhiteLabelConfig;
}

export const Navbar: React.FC<NavbarProps> = async ({ config }) => {
  const title = config?.title;

  return (
    <NextUINavbar
      classNames={{
        wrapper: 'flex flex-row flex-wrap',
      }}
      maxWidth="xl"
      position="sticky"
    >
      <NavbarContent className="basis-1/5 sm:basis-full" justify="start">
        <NavbarBrand as="li" className="gap-3 max-w-fit">
          <NextLink className="flex justify-start items-center gap-1" href="/">
            <Image alt="Logo" as={NextImage} className="min-w-10" height="42" src={config?.logoPath} width="42" />
            <p className="font-bold text-inherit text-3xl">{title}</p>
          </NextLink>
        </NavbarBrand>
        <ul className="hidden lg:flex gap-4 justify-start ml-2">
          {siteConfig.navItems.map((item) => (
            <NavbarItem key={item.href}>
              <NextLink
                className={clsx(
                  linkStyles({ color: 'foreground' }),
                  'data-[active=true]:text-primary data-[active=true]:font-medium',
                )}
                color="foreground"
                href={item.href}
              >
                {item.label}
              </NextLink>
            </NavbarItem>
          ))}
        </ul>
      </NavbarContent>

      <NavbarContent className="hidden sm:flex basis-1/5 sm:basis-full" justify="end">
        <NavbarItem className="hidden sm:flex gap-4">
          <HeaderLinks config={config} />
          <ThemeSwitch />
        </NavbarItem>
      </NavbarContent>

      {/* mobile view fallback */}
      <NavbarContent className="sm:hidden basis-1 md:min-w-fit min-w-full sm:justify-center justify-end pb-14">
        <HeaderLinks config={config} />
        <ThemeSwitch />
        {!!siteConfig.navMenuItems.length && <NavbarMenuToggle />}
      </NavbarContent>

      <NavbarMenu>
        <div className="mx-4 mt-2 flex flex-col gap-2">
          {siteConfig.navMenuItems.map((item, index) => (
            <NavbarMenuItem key={`${item}-${index}`}>
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
