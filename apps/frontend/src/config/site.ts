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
  title?: string;
  logoPath?: string;
}

export const defaultLinks: HeaderLink[] = [
  {
    id: 'default-github',
    label: 'GitHub',
    url: 'https://github.com/CyborgTests/playwright-reports-server',
    icon: 'github',
  },
];

export const siteConfig: SiteConfig = {
  name: 'Playwright Reports Server',
  description: 'A server for Playwright Reports',
  title: '', // empty since logo contains text
  logoPath: '/logo.svg',
  navItems: [
    {
      label: 'Overview',
      href: '/',
    },
    {
      label: 'Dashboard',
      href: '/analytics',
    },
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
