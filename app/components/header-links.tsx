import { Link } from '@heroui/link';

import { GithubIcon, DiscordIcon, TelegramIcon, LinkIcon, BitbucketIcon, CyborgTestIcon } from '@/app/components/icons';
import { SiteWhiteLabelConfig } from '@/app/types';

interface HeaderLinksProps {
  config: SiteWhiteLabelConfig;
  withTitle?: boolean;
}

export const HeaderLinks: React.FC<HeaderLinksProps> = ({ config, withTitle = false }) => {
  const links = config?.headerLinks;

  const availableSocialLinkIcons = [
    { name: 'telegram', Icon: TelegramIcon, title: 'Telegram' },
    { name: 'discord', Icon: DiscordIcon, title: 'Discord' },
    { name: 'github', Icon: GithubIcon, title: 'GitHub' },
    { name: 'cyborgTest', Icon: CyborgTestIcon, title: 'Cyborg Test' },
    { name: 'bitbucket', Icon: BitbucketIcon, title: 'Bitbucket' },
  ];

  const socialLinks = Object.entries(links).map(([name, href]) => {
    const availableLink = availableSocialLinkIcons.find((available) => available.name === name);

    const Icon = availableLink?.Icon ?? LinkIcon;
    const title = availableLink?.title ?? name;

    return href ? (
      <Link key={name} isExternal aria-label={title} href={href} title={title}>
        <Icon className="text-default-500" size={40} />
        {withTitle && <p className="ml-2">{title}</p>}
      </Link>
    ) : null;
  });

  return socialLinks;
};
