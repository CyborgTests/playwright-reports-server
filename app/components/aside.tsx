'use client';

import { Card, CardBody, Link, Badge } from '@heroui/react';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';

import { ReportIcon, ResultIcon, SettingsIcon } from '@/app/components/icons';
import { siteConfig } from '@/app/config/site';
import useQuery from '@/app/hooks/useQuery';

interface ServerInfo {
  numOfReports: number;
  numOfResults: number;
}

const iconst = [
  { href: '/reports', icon: ReportIcon },
  { href: '/results', icon: ResultIcon },
  { href: '/settings', icon: SettingsIcon },
];

export const Aside: React.FC = () => {
  const pathname = usePathname();
  const session = useSession();

  const { data: serverInfo } = useQuery<ServerInfo>('/api/info', {
    dependencies: [],
  });

  const isAuthenticated = session.status === 'authenticated';

  return (
    <Card className="w-16 h-full rounded-none border-r border-gray-200 dark:border-gray-800 dark:bg-black shadow-none">
      <CardBody className="px-2 py-4">
        <div className="space-y-2">
          {siteConfig.navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = iconst.find((icon) => icon.href === item.href)?.icon;
            const count =
              item.href === '/reports'
                ? serverInfo?.numOfReports
                : item.href === '/results'
                  ? serverInfo?.numOfResults
                  : 0;

            return (
              <Link
                key={item.href}
                as={NextLink}
                className={`relative flex items-center justify-center p-2 my-2 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-[#D4E8F5] dark:bg-black text-primary dark:text-primary'
                    : 'hover:bg-[#EEF7FC] dark:hover:bg-black'
                }`}
                href={item.href}
                isDisabled={!isAuthenticated}
                title={item.label}
              >
                {count !== undefined && count > 0 ? (
                  <Badge
                    className="absolute -top-1 -right-1 min-w-[18px] h-[18px] text-[10px] font-medium flex items-center justify-center"
                    color="primary"
                    content={count}
                    size="sm"
                  >
                    {Icon && <Icon size={24} />}
                  </Badge>
                ) : (
                  Icon && <Icon size={24} />
                )}
              </Link>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
};
