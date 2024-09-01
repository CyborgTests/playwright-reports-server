'use server';
import { Badge } from '@nextui-org/react';

import { ReportIcon, ResultIcon } from './icons';

import { getServerDataInfo } from '@/app/lib/data';

export default async function FilesystemStatIcons() {
  const info = await getServerDataInfo();

  return (
    <div className="flex items-center gap-8">
      <div className="flex items-center gap-12">
        <Badge color="danger" content={info.numOfReports} placement="top-left" shape="circle">
          <ReportIcon />
          Reports
          <br />
          {info.reportsFolderSizeinMB}
        </Badge>
        <Badge color="danger" content={info.numOfResults} placement="top-left" shape="circle">
          <ResultIcon />
          Results
          <br />
          {info.resultsFolderSizeinMB}
        </Badge>
      </div>
    </div>
  );
}
