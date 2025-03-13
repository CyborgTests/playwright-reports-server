import { Badge, Tab, Tabs } from '@heroui/react';

import { type ServerDataInfo } from '@/app/lib/storage';
import { ReportIcon, ResultIcon, TrendIcon } from '@/app/components/icons';
import Reports from '@/app/components/reports';
import Results from '@/app/components/results';
import ReportTrends from '@/app/components/report-trends';

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
          tabList: 'flex sm:flex-row flex-col',
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
        <Tab
          key="trends"
          isDisabled={!info?.numOfReports || info?.numOfReports <= 1}
          title={
            <div className="flex flex-col w-20 items-center">
              <TrendIcon />
              <p>Trends</p>
            </div>
          }
        >
          <ReportTrends />
        </Tab>
      </Tabs>
    </div>
  );
}
