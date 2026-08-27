import {
  CLEANUP_RULES,
  type CleanupKind,
  type CronConfig,
  DEFAULT_CLEANUP_SCHEDULES,
  type ServerConfig,
} from '@playwright-reports/shared';
import { CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { EditableSettingsSection } from '../types';
import CleanupRules from './CleanupRules';
import { cleanupSummary } from './cleanup-helpers';
import SettingsSectionHeader from './SettingsSectionHeader';

interface CronConfigurationProps {
  config: ServerConfig;
  tempConfig: ServerConfig;
  editingSection: EditableSettingsSection;
  isUpdating: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onUpdateTempConfig: (updates: Partial<ServerConfig>) => void;
}

const SCHEDULES = [
  {
    key: 'reportExpireCronSchedule',
    label: 'Reports cleanup schedule',
    help: 'When the report rules run.',
  },
  {
    key: 'resultExpireCronSchedule',
    label: 'Results cleanup schedule',
    help: 'Deletes uploaded result blobs.',
  },
] as const;

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
  const saved: CronConfig = config.cron ?? {};
  const draft: CronConfig = (isEditing ? tempConfig.cron : config.cron) ?? {};
  const setDays = (kind: CleanupKind, value: string) => {
    const parsed = Number.parseInt(value, 10);
    onUpdateTempConfig({
      cron: {
        ...tempConfig.cron,
        [CLEANUP_RULES[kind].daysKey]: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
      },
    });
  };

  return (
    <Card id="cron" className="mb-6 scroll-mt-20 p-4">
      <SettingsSectionHeader
        title="Cleanup"
        icon={CalendarClock}
        isEditing={isEditing}
        canEdit={editingSection === 'none'}
        isUpdating={isUpdating}
        onEdit={onEdit}
        onSave={onSave}
        onCancel={onCancel}
      />
      <CardContent className="space-y-5">
        <CleanupRules saved={saved} draft={draft} isEditing={isEditing} onDaysChange={setDays} />

        <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">{cleanupSummary(saved)}</p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {SCHEDULES.map((schedule) => (
            <div key={schedule.key} className="space-y-2">
              <Label htmlFor={schedule.key}>{schedule.label}</Label>
              <Input
                id={schedule.key}
                disabled={!isEditing}
                placeholder={DEFAULT_CLEANUP_SCHEDULES[schedule.key]}
                className="font-mono"
                value={draft[schedule.key] ?? ''}
                onChange={(event) =>
                  onUpdateTempConfig({
                    cron: { ...tempConfig.cron, [schedule.key]: event.target.value },
                  })
                }
              />
              <p className="text-xs text-muted-foreground">{schedule.help}</p>
            </div>
          ))}
        </div>

        {isEditing && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onUpdateTempConfig({
                cron: {
                  ...tempConfig.cron,
                  ...Object.fromEntries(
                    SCHEDULES.map((schedule) => [
                      schedule.key,
                      DEFAULT_CLEANUP_SCHEDULES[schedule.key],
                    ])
                  ),
                },
              })
            }
          >
            Reset schedules to defaults
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
