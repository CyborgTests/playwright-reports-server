export type SiteConfig = typeof siteConfig;

export const siteConfig = {
  name: 'Playwright Reports Server',
  description: 'A server for Playwright Reports',
  navItems: [
    {
      label: 'Results',
      href: '/results',
    },
  ],
  navMenuItems: [
    {
      label: 'Results',
      href: '/results',
    },
  ],
  links: {
    github: 'https://github.com/CyborgTests/playwright-reports-server',
    discord: 'https://discord.gg/nuacYsb2yN',
    sponsor: 'https://patreon.com/SOMELINKHERE',
  },
};
