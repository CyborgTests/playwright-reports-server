'use server';
import { Badge } from '@nextui-org/react';
import Link from 'next/link';

import { ReportIcon, ResultIcon } from './icons';

import { getServerDataInfo } from '@/app/lib/data';

export default async function FilesystemStatIcons() {
  const info = await getServerDataInfo();

  return (
    <div className="flex items-center gap-10">
      <div className="flex items-center gap-12">
        <div className="hover:opacity-20">
          <Link href="/reports">
            <Badge color="danger" content={info.numOfReports} placement="top-left" shape="circle">
              <ReportIcon />
              Reports
              <br />
              {info.reportsFolderSizeinMB}
            </Badge>
          </Link>
        </div>
        <div className="hover:opacity-20">
          <Link href="/results">
            <Badge color="danger" content={info.numOfResults} placement="top-left" shape="circle">
              <ResultIcon />
              Results
              <br />
              {info.resultsFolderSizeinMB}
            </Badge>
          </Link>
        </div>
      </div>
    </div>
  );
}
