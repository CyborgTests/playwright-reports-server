import { SVGProps } from 'react';

import { type HeaderLinks } from '@/app/config/site';

export type IconSvgProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

export type UUID = `${string}-${string}-${string}-${string}-${string}`;

export interface SiteWhiteLabelConfig {
  title: string;
  headerLinks: HeaderLinks;
  logoPath: string;
  faviconPath: string;
}
