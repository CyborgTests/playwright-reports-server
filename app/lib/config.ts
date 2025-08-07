import { SiteWhiteLabelConfig } from '@/app/types';
import { defaultLinks } from '@/app/config/site';

export const defaultConfig: SiteWhiteLabelConfig = {
  title: 'Cyborg Tests',
  headerLinks: defaultLinks,
  logoPath: '/logo.svg',
  faviconPath: '/favicon.ico',
};

export const noConfigErr = 'no config';

export const isConfigValid = (config: any): config is SiteWhiteLabelConfig => {
  return (
    !!config &&
    typeof config === 'object' &&
    'title' in config &&
    'headerLinks' in config &&
    'logoPath' in config &&
    'faviconPath' in config
  );
};
