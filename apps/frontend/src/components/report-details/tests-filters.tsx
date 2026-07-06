import type { ReportHistory, ReportTestOutcome } from '@playwright-reports/shared';
import { type FC, useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { testStatusToColor } from '@/lib/tailwind';
import { filterReportHistory, pluralize } from '@/lib/transformers';

type ReportFiltersProps = {
  report: ReportHistory;
  onChangeFilters: (report: ReportHistory) => void;
};

const testOutcomes: ReportTestOutcome[] = ['expected', 'unexpected', 'skipped', 'flaky'];

const ReportFilters: FC<ReportFiltersProps> = ({ report, onChangeFilters }) => {
  const [byName, setByName] = useState('');
  const [byOutcomes, setByOutcomes] = useState<ReportTestOutcome[]>(testOutcomes);

  const onNameChange = (name: string) => {
    setByName(name);
  };

  const onOutcomeChange = (outcomes: ReportTestOutcome[]) => {
    setByOutcomes(outcomes?.length ? outcomes : testOutcomes);
  };

  const currentState = useMemo(() => {
    return filterReportHistory(report, {
      search: byName,
      status: byOutcomes,
    });
  }, [byName, byOutcomes, report]);

  useEffect(() => {
    onChangeFilters(currentState);
  }, [currentState, onChangeFilters]);

  return (
    <Accordion type="single" collapsible className="mb-5">
      <AccordionItem value="filter">
        <AccordionTrigger>
          <div className="flex flex-row gap-2 justify-between w-full pr-4">
            <p>Showing</p>
            <span className="text-muted-foreground">
              {currentState.testCount}/{currentState.totalTestCount}{' '}
              {pluralize(currentState.testCount || 0, 'test')}
            </span>
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4 pt-4">
            <div>
              <Label>Status</Label>
              <div className="flex flex-wrap gap-4 mt-2">
                {testOutcomes.map((outcome) => {
                  const status = testStatusToColor(outcome);

                  return (
                    <div key={outcome} className="flex items-center space-x-2">
                      <Checkbox
                        id={outcome}
                        checked={byOutcomes.includes(outcome)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            onOutcomeChange([...byOutcomes, outcome]);
                          } else {
                            onOutcomeChange(byOutcomes.filter((o) => o !== outcome));
                          }
                        }}
                      />
                      <label
                        htmlFor={outcome}
                        className={`text-sm font-medium ${status.colorName}`}
                      >
                        {status.title}
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <Label htmlFor="title-filter">Title</Label>
              <Input
                id="title-filter"
                value={byName}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Filter by title..."
              />
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};

export default ReportFilters;
