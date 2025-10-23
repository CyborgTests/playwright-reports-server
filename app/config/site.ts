interface NavItem {
  label: string;
  href: string;
}

export type HeaderLinks = Record<string, string>;

interface SiteConfig {
  name: string;
  description: string;
  navItems: NavItem[];
  navMenuItems: NavItem[];
  links: HeaderLinks;
}

export const defaultLinks: HeaderLinks = {
  github: 'https://github.com/CyborgTests/playwright-reports-server',
  telegram: 'https://t.me/js_for_testing/',
  discord: 'https://discord.gg/nuacYsb2yN',
  cyborgTest: 'https://www.cyborgtest.com/',
};

export const siteConfig: SiteConfig = {
  name: 'Playwright Reports Server',
  description: 'A server for Playwright Reports',
  navItems: [
    {
      label: 'Reports',
      href: '/reports',
    },
    {
      label: 'Results',
      href: '/results',
    },
    {
      label: 'Trends',
      href: '/trends',
    },
    {
      label: 'Settings',
      href: '/settings',
    },
  ],
  navMenuItems: [
    {
      label: 'Reports',
      href: '/reports',
    },
    {
      label: 'Results',
      href: '/results',
    },
    {
      label: 'Trends',
      href: '/trends',
    },
    {
      label: 'Settings',
      href: '/settings',
    },
  ],
  links: defaultLinks,
};
