'use client';

import { Badge, Tab, Tabs } from '@nextui-org/react';

import { type ServerDataInfo } from '@/app/lib/data';
import { ReportIcon, ResultIcon } from '@/app/components/icons';
import Reports from '@/app/components/reports';
import Results from '@/app/components/results';

interface FilesystemStatTabsProps {
  info?: ServerDataInfo;
  selected: string;
  onUpdate: () => void;
  onSelect: (key: string) => void;
}

export default function FilesystemStatTabs({ info, selected, onSelect, onUpdate }: Readonly<FilesystemStatTabsProps>) {
  const onChangeTab = (key: string | number) => {
    if (typeof key === 'number') {
      return;
    }

    onSelect?.(key);
  };

  return (
    <div className="gap-10">
      <Tabs
        aria-label="Options"
        classNames={{
          tab: 'h-16',
          panel: 'w-full',
          tabContent: 'w-full',
        }}
        selectedKey={selected ?? 'reports'}
        variant="bordered"
        onSelectionChange={onChangeTab}
      >
        <Tab
          key="reports"
          title={
            <Badge color="danger" content={info?.numOfReports} placement="top-left" shape="circle">
              <ReportIcon />
              Reports
              <br />
              {info?.reportsFolderSizeinMB}
            </Badge>
          }
        >
          <Reports onChange={onUpdate} />
        </Tab>
        <Tab
          key="results"
          title={
            <Badge color="danger" content={info?.numOfResults} placement="top-left" shape="circle">
              <ResultIcon />
              Results
              <br />
              {info?.resultsFolderSizeinMB}
            </Badge>
          }
        >
          <Results onChange={onUpdate} />
        </Tab>
      </Tabs>
    </div>
  );
}
