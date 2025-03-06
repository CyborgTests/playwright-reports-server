import { Link } from "@heroui/link";

import { GithubIcon, DiscordIcon, TelegramIcon, LinkIcon, BitbucketIcon } from '@/app/components/icons';
import { SiteWhiteLabelConfig } from '@/app/types';

interface HeaderLinksProps {
  config: SiteWhiteLabelConfig;
}

export const HeaderLinks: React.FC<HeaderLinksProps> = async ({ config }) => {
  const links = config?.headerLinks;

  const availableSocialLinkIcons = [
    { name: 'telegram', Icon: TelegramIcon },
    { name: 'discord', Icon: DiscordIcon },
    { name: 'github', Icon: GithubIcon },
    { name: 'bitbucket', Icon: BitbucketIcon },
  ];

  const socialLinks = Object.entries(links).map(([name, href]) => {
    const availableLink = availableSocialLinkIcons.find((available) => available.name === name);

    const Icon = availableLink?.Icon ?? LinkIcon;

    return href ? (
      <Link key={name} isExternal aria-label={name} href={href}>
        <Icon className="text-default-500" size={48} />
        {!availableLink && <p className="ml-1">{name}</p>}
      </Link>
    ) : null;
  });

  return socialLinks;
};
