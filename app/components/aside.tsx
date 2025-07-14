'use client';

import { Card, CardBody, Link } from '@heroui/react';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';

import { ReportIcon, ResultIcon } from '@/app/components/icons';
import { siteConfig } from '@/app/config/site';

export const Aside: React.FC = () => {
  const pathname = usePathname();

  return (
    <Card className="w-16 h-full rounded-none border-r-2 border-[#F9FAFB] shadow-none">
      <CardBody className="p-2">
        <div className="space-y-2">
          {siteConfig.navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.href === '/reports' ? ReportIcon : item.href === '/results' ? ResultIcon : null;

            return (
              <Link
                key={item.href}
                as={NextLink}
                className={`flex items-center justify-center p-2 rounded-lg transition-colors ${
                  isActive ? 'bg-[#D4E8F5] text-primary' : 'hover:bg-[#EEF7FC]'
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
