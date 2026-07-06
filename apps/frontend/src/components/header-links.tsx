import type { HeaderLink, SiteWhiteLabelConfig } from '@playwright-reports/shared';
import { Link } from 'react-router-dom';
import { withBase } from '@/lib/url';
import { getPresetIcon, HEADER_LINK_ICON_CATALOG } from './header-link-icons';
import { LinkIcon } from './icons';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

interface HeaderLinksProps {
  config: SiteWhiteLabelConfig;
  withTitle?: boolean;
  size?: number;
}

function isCustomIconPath(icon: string | undefined): boolean {
  return !!icon && icon.startsWith('/branding/');
}

function renderIcon(link: HeaderLink, size: number) {
  const icon = link.icon;
  if (isCustomIconPath(icon)) {
    return (
      <img
        alt={`${link.label} icon`}
        src={withBase(`/api/static${icon}`)}
        style={{ height: size, width: size }}
        className="object-contain"
      />
    );
  }
  const preset = icon ? getPresetIcon(icon) : undefined;
  const Icon = preset?.Icon ?? LinkIcon;
  return <Icon size={size} />;
}

function presetTitle(icon: string | undefined): string | undefined {
  if (!icon || isCustomIconPath(icon)) return undefined;
  return HEADER_LINK_ICON_CATALOG.find((c) => c.name === icon)?.title;
}

export const HeaderLinks: React.FC<HeaderLinksProps> = ({
  config,
  withTitle = false,
  size = 40,
}) => {
  const links = (config?.headerLinks ?? []).filter((link) => link.url);

  if (!links.length) return null;

  return (
    <TooltipProvider delayDuration={150}>
      {links.map((link) => {
        const label = link.label || presetTitle(link.icon) || link.url;
        const showInlineLabel = withTitle || !!link.showLabel;
        return (
          <Tooltip key={link.id}>
            <TooltipTrigger asChild>
              <Link
                to={link.url}
                target="_blank"
                rel="noreferrer"
                aria-label={label}
                className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2"
              >
                {renderIcon(link, size)}
                {showInlineLabel && <span className="text-sm">{label}</span>}
              </Link>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </TooltipProvider>
  );
};
