import type { HeaderLink } from '@playwright-reports/shared';

export const defaultLinks: HeaderLink[] = [
  {
    id: 'default-docs',
    label: 'Docs',
    url: 'https://cyborgtests.github.io/playwright-reports-server/',
    icon: 'cyborgTest',
    showLabel: true,
  },
  {
    id: 'default-github',
    label: 'GitHub',
    url: 'https://github.com/CyborgTests/playwright-reports-server',
    icon: 'github',
  },
];
