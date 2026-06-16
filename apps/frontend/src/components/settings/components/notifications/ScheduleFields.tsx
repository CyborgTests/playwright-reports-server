import type { ScheduleCondition, ScheduleRule, ScheduleWindow } from '@playwright-reports/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const SCHEDULE_CONDITION_LABELS: Record<ScheduleCondition, string> = {
  always: 'Always (any activity)',
  all_clean: 'All clean (zero failures and flakies)',
  no_hard_failures: 'No hard failures (flakies allowed)',
};

const SCHEDULE_WINDOW_LABELS: Record<ScheduleWindow, string> = {
  last_24h: 'Last 24 hours',
  last_7d: 'Last 7 days',
  last_14d: 'Last 2 weeks',
  since_last_send: 'Since last send (no overlap)',
};

interface ScheduleFieldsProps {
  rule: ScheduleRule;
  onChange: (patch: Partial<ScheduleRule>) => void;
  onConditionChange: (condition: ScheduleCondition) => void;
}

export function ScheduleFields({
  rule,
  onChange,
  onConditionChange,
}: Readonly<ScheduleFieldsProps>) {
  const cadenceValue = typeof rule.cadence === 'string' ? rule.cadence : 'custom';

  const setCadence = (v: string) => {
    if (v === 'daily' || v === 'weekly') {
      onChange({ cadence: v });
    } else {
      onChange({ cadence: { cron: '0 9 * * *' } });
    }
  };

  return (
    <>
      <div className="grid gap-2 grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="cadence">Cadence</Label>
          <Select value={cadenceValue} onValueChange={setCadence}>
            <SelectTrigger id="cadence">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="custom">Custom cron…</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="send-at">Send at</Label>
          <Input
            id="send-at"
            type="time"
            value={rule.sendAt}
            onChange={(e) => onChange({ sendAt: e.target.value })}
            disabled={cadenceValue === 'custom'}
          />
        </div>
      </div>

      {cadenceValue === 'custom' && (
        <div className="space-y-2">
          <Label htmlFor="cron">Cron expression</Label>
          <Input
            id="cron"
            value={typeof rule.cadence === 'string' ? '' : rule.cadence.cron}
            onChange={(e) => onChange({ cadence: { cron: e.target.value } })}
            placeholder="0 9 * * 1-5"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Five space-separated fields. Server timezone.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="window">Window</Label>
        <Select
          value={rule.window}
          onValueChange={(v) => onChange({ window: v as ScheduleWindow })}
        >
          <SelectTrigger id="window">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SCHEDULE_WINDOW_LABELS) as ScheduleWindow[]).map((w) => (
              <SelectItem key={w} value={w}>
                {SCHEDULE_WINDOW_LABELS[w]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="schedule-condition">Send when</Label>
        <Select
          value={rule.condition}
          onValueChange={(v) => onConditionChange(v as ScheduleCondition)}
        >
          <SelectTrigger id="schedule-condition">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SCHEDULE_CONDITION_LABELS) as ScheduleCondition[]).map((c) => (
              <SelectItem key={c} value={c}>
                {SCHEDULE_CONDITION_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
