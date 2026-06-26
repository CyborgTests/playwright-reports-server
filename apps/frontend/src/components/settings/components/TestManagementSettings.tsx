import { FLAKINESS_THRESHOLDS, type ServerConfig } from '@playwright-reports/shared';
import { FlaskConical } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import type { EditableSettingsSection } from '../types';
import SettingsSectionHeader from './SettingsSectionHeader';

interface TestManagementSettingsProps {
  tempConfig: ServerConfig;
  editingSection: EditableSettingsSection;
  isUpdating: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onUpdateTempConfig: (updates: Partial<ServerConfig>) => void;
}

const DEFAULT_QUARANTINE_THRESHOLD = FLAKINESS_THRESHOLDS.QUARANTINE_PERCENTAGE;
const DEFAULT_WARNING_THRESHOLD = FLAKINESS_THRESHOLDS.WARNING_PERCENTAGE;
const DEFAULT_FLAKINESS_MIN_RUNS = 5;
const DEFAULT_FLAKINESS_EVALUATION_WINDOW_DAYS = 30;

function ThresholdField({
  id,
  label,
  help,
  value,
  error,
  disabled,
  onChange,
}: Readonly<{
  id: string;
  label: string;
  help: string;
  value: number;
  error: string | null;
  disabled: boolean;
  onChange: (value: number | undefined) => void;
}>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-4">
        <Slider
          id={`${id}-slider`}
          className="flex-1"
          disabled={disabled}
          max={100}
          min={0}
          step={1}
          value={[Number.isFinite(value) ? value : 0]}
          onValueChange={([v]) => {
            if (!disabled) onChange(v);
          }}
        />
        <Input
          id={id}
          className="w-20"
          disabled={disabled}
          type="number"
          value={Number.isFinite(value) ? value.toString() : ''}
          onChange={(e) => {
            if (disabled) return;
            const raw = e.target.value;
            onChange(raw === '' ? undefined : Number.parseFloat(raw));
          }}
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

function IntField({
  id,
  label,
  help,
  value,
  disabled,
  onChange,
}: Readonly<{
  id: string;
  label: string;
  help: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        disabled={disabled}
        min={1}
        type="number"
        value={value.toString()}
        onChange={(e) => {
          if (disabled) return;
          const v = Number.parseInt(e.target.value, 10);
          if (!Number.isNaN(v) && v >= 1) onChange(v);
        }}
      />
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

export default function TestManagementSettings({
  tempConfig,
  editingSection,
  isUpdating,
  onEdit,
  onSave,
  onCancel,
  onUpdateTempConfig,
}: Readonly<TestManagementSettingsProps>) {
  const testManagement = tempConfig.testManagement ?? {};
  const disabled = editingSection !== 'testManagement';

  const update = (updates: Partial<ServerConfig['testManagement']>) => {
    onUpdateTempConfig({ testManagement: { ...testManagement, ...updates } });
  };

  const handleReset = () => {
    update({
      quarantineThresholdPercentage: DEFAULT_QUARANTINE_THRESHOLD,
      warningThresholdPercentage: DEFAULT_WARNING_THRESHOLD,
      autoQuarantineEnabled: false,
      flakinessMinRuns: DEFAULT_FLAKINESS_MIN_RUNS,
      flakinessEvaluationWindowDays: DEFAULT_FLAKINESS_EVALUATION_WINDOW_DAYS,
    });
  };

  const quarantineThreshold =
    testManagement.quarantineThresholdPercentage ?? DEFAULT_QUARANTINE_THRESHOLD;
  const warningThreshold = testManagement.warningThresholdPercentage ?? DEFAULT_WARNING_THRESHOLD;
  const autoQuarantineEnabled = testManagement.autoQuarantineEnabled ?? false;
  const flakinessMinRuns = testManagement.flakinessMinRuns ?? DEFAULT_FLAKINESS_MIN_RUNS;
  const flakinessEvaluationWindowDays =
    testManagement.flakinessEvaluationWindowDays ?? DEFAULT_FLAKINESS_EVALUATION_WINDOW_DAYS;

  // backend re-validates on save; transient invalid values are fine.
  const validateThreshold = (n: number, label: string): string | null => {
    if (Number.isNaN(n)) return `${label} must be a number`;
    if (n < 0 || n > 100) return `${label} must be between 0 and 100`;
    return null;
  };
  const warningError =
    validateThreshold(warningThreshold, 'Warning threshold') ??
    (warningThreshold >= quarantineThreshold
      ? 'Warning must be lower than the quarantine threshold'
      : null);
  const quarantineError = validateThreshold(quarantineThreshold, 'Quarantine threshold');

  return (
    <Card id="testManagement" className="mb-6 scroll-mt-20 p-4">
      <SettingsSectionHeader
        title="Test Management"
        icon={FlaskConical}
        isEditing={editingSection === 'testManagement'}
        canEdit={editingSection === 'none'}
        isUpdating={isUpdating}
        onEdit={onEdit}
        onSave={onSave}
        onCancel={onCancel}
      />
      <CardContent>
        <div className="space-y-6">
          <Alert>
            <h3 className="font-medium mb-2">About Test Management Settings</h3>
            <p className="text-sm">
              Configure thresholds for test flakiness detection and automatic quarantine. Tests
              exceeding these thresholds will be flagged or quarantined based on their failure
              history.
            </p>
          </Alert>

          <Separator />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ThresholdField
              id="warning-threshold"
              label="Warning Threshold (%)"
              help="Tests at or above this score are marked with a warning indicator."
              value={warningThreshold}
              error={warningError}
              disabled={disabled}
              onChange={(v) => update({ warningThresholdPercentage: v })}
            />
            <ThresholdField
              id="quarantine-threshold"
              label="Quarantine Threshold (%)"
              help="Tests at or above this score are auto-quarantined (when auto-quarantine is enabled)."
              value={quarantineThreshold}
              error={quarantineError}
              disabled={disabled}
              onChange={(v) => update({ quarantineThresholdPercentage: v })}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium">Auto-Quarantine Tests</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Automatically quarantine tests that exceed the quarantine threshold
              </p>
            </div>
            <Switch
              disabled={disabled}
              checked={autoQuarantineEnabled}
              onCheckedChange={(checked) => {
                if (!disabled) update({ autoQuarantineEnabled: checked });
              }}
            />
          </div>

          <Separator />

          <IntField
            id="flakiness-min-runs"
            label="Minimum Runs for Flakiness Evaluation"
            help="Minimum number of times a test must run before being evaluated for flakiness"
            value={flakinessMinRuns}
            disabled={disabled}
            onChange={(v) => update({ flakinessMinRuns: v })}
          />

          <IntField
            id="flakiness-evaluation-window"
            label="Evaluation Window (Days)"
            help="Number of days to look back when calculating test flakiness scores"
            value={flakinessEvaluationWindowDays}
            disabled={disabled}
            onChange={(v) => update({ flakinessEvaluationWindowDays: v })}
          />

          {editingSection === 'testManagement' && (
            <Button variant="outline" size="sm" onClick={handleReset}>
              Reset to Defaults
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
