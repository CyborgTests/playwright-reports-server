import type { HeaderLink } from '@playwright-reports/shared';

interface NavItem {
  label: string;
  href: string;
}

interface SiteConfig {
  name: string;
  description: string;
  navItems: NavItem[];
  navMenuItems: NavItem[];
  links: HeaderLink[];
}

export const defaultLinks: HeaderLink[] = [
  {
    id: 'default-github',
    label: 'GitHub',
    url: 'https://github.com/Shelex/playwright-reports-server',
    icon: 'github',
  },
];

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
