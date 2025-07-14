'use client';

import { Card, CardBody, Link } from '@heroui/react';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';

import { ReportIcon, ResultIcon } from '@/app/components/icons';
import { siteConfig } from '@/app/config/site';

export const Aside: React.FC = () => {
  const pathname = usePathname();

  return (
    <Card className="w-16 h-full rounded-none border-r border-gray-200 dark:border-gray-800 dark:bg-black shadow-none">
      <CardBody className="px-2 py-4">
        <div className="space-y-2">
          {siteConfig.navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.href === '/reports' ? ReportIcon : item.href === '/results' ? ResultIcon : null;

            return (
              <Link
                key={item.href}
                as={NextLink}
                className={`flex items-center justify-center p-2 my-2 rounded-lg transition-colors ${
                  isActive 
                    ? 'bg-[#D4E8F5] dark:bg-black text-primary dark:text-primary' 
                    : 'hover:bg-[#EEF7FC] dark:hover:bg-black'
                }`}
                href={item.href}
                title={item.label}
              >
                {Icon && <Icon size={24} />}
              </Link>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
};
