'use client';

import type { ServerConfig } from '@playwright-reports/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface CronConfigurationProps {
  config: ServerConfig;
  tempConfig: ServerConfig;
  editingSection: string;
  isUpdating: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onUpdateTempConfig: (updates: Partial<ServerConfig>) => void;
}

interface CleanupGroupProps {
  title: string;
  description: string;
  daysId: string;
  daysLabel: string;
  daysHelp: string;
  daysPlaceholder: string;
  daysValue: string;
  scheduleId: string;
  scheduleLabel: string;
  scheduleHelp: string;
  schedulePlaceholder: string;
  scheduleValue: string;
  disabled: boolean;
  onDaysChange: (value: string) => void;
  onScheduleChange: (value: string) => void;
}

function isCleanupEnabled(daysValue: string, scheduleValue: string): boolean {
  const days = Number.parseInt(daysValue, 10);
  return Number.isFinite(days) && days > 0 && scheduleValue.trim().length > 0;
}

function CleanupGroup({
  title,
  description,
  daysId,
  daysLabel,
  daysHelp,
  daysPlaceholder,
  daysValue,
  scheduleId,
  scheduleLabel,
  scheduleHelp,
  schedulePlaceholder,
  scheduleValue,
  disabled,
  onDaysChange,
  onScheduleChange,
}: CleanupGroupProps) {
  const enabled = isCleanupEnabled(daysValue, scheduleValue);
  return (
    <div
      className={cn(
        'space-y-4 rounded-lg border-2 p-4 transition-colors',
        enabled
          ? 'border-emerald-500/40 bg-emerald-500/[0.04]'
          : 'border-dashed border-muted-foreground/30 bg-muted/30'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
        <Badge
          variant={enabled ? 'success' : 'outline'}
          className={cn(
            'shrink-0 gap-1.5 px-2 py-0.5',
            !enabled && 'text-muted-foreground border-muted-foreground/40'
          )}
        >
          <span
            className={cn(
              'inline-block h-1.5 w-1.5 rounded-full',
              enabled ? 'bg-emerald-500' : 'bg-muted-foreground/60'
            )}
            aria-hidden
          />
          {enabled ? 'Enabled' : 'Disabled'}
        </Badge>
      </div>
      <div className="space-y-2">
        <Label htmlFor={daysId}>{daysLabel}</Label>
        <Input
          id={daysId}
          disabled={disabled}
          placeholder={daysPlaceholder}
          type="number"
          inputMode="numeric"
          className="max-w-[140px] font-mono"
          value={daysValue}
          onChange={(e) => onDaysChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{daysHelp}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={scheduleId}>{scheduleLabel}</Label>
        <Input
          id={scheduleId}
          disabled={disabled}
          placeholder={schedulePlaceholder}
          className="max-w-[220px] font-mono"
          value={scheduleValue}
          onChange={(e) => onScheduleChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{scheduleHelp}</p>
      </div>
      {!enabled && (
        <p className="text-xs text-muted-foreground italic">
          Set both a positive "expire after" value and a schedule to enable this task.
        </p>
      )}
    </div>
  );
}

export default function CronConfiguration({
  config,
  tempConfig,
  editingSection,
  isUpdating,
  onEdit,
  onSave,
  onCancel,
  onUpdateTempConfig,
}: Readonly<CronConfigurationProps>) {
  const isEditing = editingSection === 'cron';
  const source = isEditing ? tempConfig.cron : config.cron;

  return (
    <Card id="cron" className="mb-6 scroll-mt-20 p-4">
      <CardHeader
        className={cn(
          'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
          isEditing && 'bg-primary/5 border-l-4 border-primary -mx-4 px-4'
        )}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">Cron Settings</h2>
          {isEditing && (
            <Badge variant="secondary" className="text-xs">
              Editing
            </Badge>
          )}
        </div>
        {!isEditing ? (
          <Button disabled={editingSection !== 'none'} onClick={onEdit}>
            {editingSection === 'none' ? 'Edit Configuration' : 'Editing other section'}
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button disabled={isUpdating} onClick={onSave}>
              {isUpdating ? 'Saving...' : 'Save Changes'}
            </Button>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CleanupGroup
              title="Results cleanup"
              description="Raw blob ZIPs uploaded by Playwright runs."
              daysId="result-expire-days"
              daysLabel="Expire after (days)"
              daysHelp="Results older than this are deleted."
              daysPlaceholder="30"
              daysValue={source?.resultExpireDays?.toString() ?? ''}
              scheduleId="result-expire-cron-schedule"
              scheduleLabel="Cleanup schedule"
              scheduleHelp={'Cron expression — e.g. "0 2 * * *" runs daily at 02:00.'}
              schedulePlaceholder="0 2 * * *"
              scheduleValue={source?.resultExpireCronSchedule ?? ''}
              disabled={!isEditing}
              onDaysChange={(value) =>
                onUpdateTempConfig({
                  cron: {
                    ...tempConfig.cron,
                    resultExpireDays: Number.parseInt(value, 10) || undefined,
                  },
                })
              }
              onScheduleChange={(value) =>
                onUpdateTempConfig({
                  cron: { ...tempConfig.cron, resultExpireCronSchedule: value },
                })
              }
            />
            <CleanupGroup
              title="Reports cleanup"
              description="Generated HTML reports served from this server."
              daysId="report-expire-days"
              daysLabel="Expire after (days)"
              daysHelp="Reports older than this are deleted."
              daysPlaceholder="90"
              daysValue={source?.reportExpireDays?.toString() ?? ''}
              scheduleId="report-expire-cron-schedule"
              scheduleLabel="Cleanup schedule"
              scheduleHelp={'Cron expression — e.g. "0 3 * * *" runs daily at 03:00.'}
              schedulePlaceholder="0 3 * * *"
              scheduleValue={source?.reportExpireCronSchedule ?? ''}
              disabled={!isEditing}
              onDaysChange={(value) =>
                onUpdateTempConfig({
                  cron: {
                    ...tempConfig.cron,
                    reportExpireDays: Number.parseInt(value, 10) || undefined,
                  },
                })
              }
              onScheduleChange={(value) =>
                onUpdateTempConfig({
                  cron: { ...tempConfig.cron, reportExpireCronSchedule: value },
                })
              }
            />
          </div>

          {isEditing && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onUpdateTempConfig({
                  cron: {
                    resultExpireDays: 30,
                    resultExpireCronSchedule: '0 2 * * *',
                    reportExpireDays: 90,
                    reportExpireCronSchedule: '0 3 * * *',
                  },
                })
              }
            >
              Reset to defaults
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
