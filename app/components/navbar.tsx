import {
  Navbar as NextUINavbar,
  NavbarContent,
  NavbarMenu,
  NavbarMenuToggle,
  NavbarBrand,
  NavbarItem,
  NavbarMenuItem,
} from '@nextui-org/navbar';
import Image from 'next/image';
import { Link } from '@nextui-org/link';
import { link as linkStyles } from '@nextui-org/theme';
import NextLink from 'next/link';
import clsx from 'clsx';

import { env } from '@/app/config/env';
import { siteConfig } from '@/app/config/site';
import { ThemeSwitch } from '@/app/components/theme-switch';
import { GithubIcon, DiscordIcon, TelegramIcon, LinkIcon } from '@/app/components/icons';

export const Navbar = async () => {
  const title = env.APP_TITLE;
  const links = env.APP_HEADER_LINKS;

  const availableSocialLinkIcons = [
    { name: 'telegram', Icon: TelegramIcon },
    { name: 'discord', Icon: DiscordIcon },
    { name: 'github', Icon: GithubIcon },
  ];

  const socialLinks = Object.entries(links).map(([name, href]) => {
    const availableLink = availableSocialLinkIcons.find((available) => available.name === name);

    const Icon = availableLink?.Icon ?? LinkIcon;

    return href ? (
      <Link key={name} isExternal aria-label={name} href={href}>
        <Icon className="text-default-500" />
        {!availableLink && <p className="ml-2">{name}</p>}
      </Link>
    ) : null;
  });

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
            <Image alt="Logo" className="min-w-10" height="42" src={env.APP_LOGO_PATH} width="42" />
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
          {socialLinks}
          <ThemeSwitch />
        </NavbarItem>
      </NavbarContent>

      {/* mobile view fallback */}
      <NavbarContent className="sm:hidden basis-1 md:min-w-fit min-w-full sm:justify-center justify-end pb-14">
        {socialLinks}
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
