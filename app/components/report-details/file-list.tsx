'use client';

import React from 'react';
import { Accordion, AccordionItem } from '@nextui-org/react';

import { subtitle } from '../primitives';
import { StatChart } from '../stat-chart';

import renderFileSuitesTree from './suite-tree';

import { ReportHistory } from '@/app/lib/data';

interface FileListProps {
  report?: ReportHistory | null;
  history: ReportHistory[];
}

const FileList: React.FC<FileListProps> = ({ report, history }) => {
  return (
    <div>
      <h2 className={subtitle()}>File list</h2>
      <Accordion variant="bordered">
        {(report?.files ?? []).map((file) => (
          <AccordionItem key={file.fileId} aria-label={file.fileName} title={file.fileName}>
            <div className="file-details">
              <StatChart stats={file.stats} />
              <div className="file-tests">
                <h4 className={subtitle()}>Tests</h4>
                {renderFileSuitesTree(file, history)}
              </div>
            </div>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
};

export default FileList;
