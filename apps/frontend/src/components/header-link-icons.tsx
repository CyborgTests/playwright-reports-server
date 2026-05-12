import type { IconSvgProps } from '@playwright-reports/shared';
import type { FC } from 'react';
import {
  BitbucketIcon,
  CyborgTestIcon,
  DiscordIcon,
  GithubIcon,
  SlackIcon,
  TelegramIcon,
} from './icons';

export interface HeaderLinkIconPreset {
  name: string;
  title: string;
  Icon: FC<IconSvgProps>;
}

export const HEADER_LINK_ICON_CATALOG: HeaderLinkIconPreset[] = [
  { name: 'github', title: 'GitHub', Icon: GithubIcon },
  { name: 'bitbucket', title: 'Bitbucket', Icon: BitbucketIcon },
  { name: 'slack', title: 'Slack', Icon: SlackIcon },
  { name: 'discord', title: 'Discord', Icon: DiscordIcon },
  { name: 'telegram', title: 'Telegram', Icon: TelegramIcon },
  { name: 'cyborgTest', title: 'Cyborg Test', Icon: CyborgTestIcon },
];

export function getPresetIcon(name: string): HeaderLinkIconPreset | undefined {
  return HEADER_LINK_ICON_CATALOG.find((c) => c.name === name);
}
