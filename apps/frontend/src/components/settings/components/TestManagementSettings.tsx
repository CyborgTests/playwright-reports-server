import { FLAKINESS_THRESHOLDS, type ServerConfig } from '@playwright-reports/shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import SettingsSectionHeader from './SettingsSectionHeader';

interface TestManagementSettingsProps {
  config: ServerConfig;
  tempConfig: ServerConfig;
  editingSection: string;
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

export default function TestManagementSettings({
  config,
  tempConfig,
  editingSection,
  isUpdating,
  onEdit,
  onSave,
  onCancel,
  onUpdateTempConfig,
}: Readonly<TestManagementSettingsProps>) {
  const testManagement = tempConfig.testManagement ?? {};
  const currentTestManagement = config.testManagement ?? {};

  const updateTestManagementConfig = (updates: Partial<ServerConfig['testManagement']>) => {
    onUpdateTempConfig({
      testManagement: {
        ...testManagement,
        ...updates,
      },
    });
  };

  const handleReset = () => {
    updateTestManagementConfig({
      quarantineThresholdPercentage: DEFAULT_QUARANTINE_THRESHOLD,
      warningThresholdPercentage: DEFAULT_WARNING_THRESHOLD,
      autoQuarantineEnabled: false,
      flakinessMinRuns: DEFAULT_FLAKINESS_MIN_RUNS,
      flakinessEvaluationWindowDays: DEFAULT_FLAKINESS_EVALUATION_WINDOW_DAYS,
    });
  };

  const quarantineThreshold =
    testManagement.quarantineThresholdPercentage ??
    currentTestManagement.quarantineThresholdPercentage ??
    DEFAULT_QUARANTINE_THRESHOLD;
  const warningThreshold =
    testManagement.warningThresholdPercentage ??
    currentTestManagement.warningThresholdPercentage ??
    DEFAULT_WARNING_THRESHOLD;
  const autoQuarantineEnabled =
    testManagement.autoQuarantineEnabled ?? currentTestManagement.autoQuarantineEnabled ?? false;
  const flakinessMinRuns =
    testManagement.flakinessMinRuns ??
    currentTestManagement.flakinessMinRuns ??
    DEFAULT_FLAKINESS_MIN_RUNS;
  const flakinessEvaluationWindowDays =
    testManagement.flakinessEvaluationWindowDays ??
    currentTestManagement.flakinessEvaluationWindowDays ??
    DEFAULT_FLAKINESS_EVALUATION_WINDOW_DAYS;

  // Render-time validation. Errors surface inline beneath each input — backend
  // also validates on save, so it's OK if the user temporarily holds an
  // invalid value.
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

          {/* Thresholds laid out side by side. Inputs accept any value while
              the user is typing — validation runs at render time and shows an
              inline error so the user can fix it before saving rather than
              having the keystroke rejected. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="warning-threshold">Warning Threshold (%)</Label>
              <div className="flex items-center gap-4">
                <Slider
                  id="warning-threshold-slider"
                  className="flex-1"
                  disabled={editingSection !== 'testManagement'}
                  max={100}
                  min={0}
                  step={1}
                  value={[Number.isFinite(warningThreshold) ? warningThreshold : 0]}
                  onValueChange={([value]) => {
                    if (editingSection === 'testManagement') {
                      updateTestManagementConfig({ warningThresholdPercentage: value });
                    }
                  }}
                />
                <Input
                  aria-label="Warning threshold input"
                  className="w-20"
                  disabled={editingSection !== 'testManagement'}
                  type="number"
                  value={Number.isFinite(warningThreshold) ? warningThreshold.toString() : ''}
                  onChange={(e) => {
                    if (editingSection !== 'testManagement') return;
                    const raw = e.target.value;
                    updateTestManagementConfig({
                      warningThresholdPercentage: raw === '' ? undefined : Number.parseFloat(raw),
                    });
                  }}
                />
              </div>
              {warningError && <p className="text-xs text-destructive">{warningError}</p>}
              <p className="text-xs text-muted-foreground">
                Tests at or above this score are marked with a warning indicator.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quarantine-threshold">Quarantine Threshold (%)</Label>
              <div className="flex items-center gap-4">
                <Slider
                  id="quarantine-threshold-slider"
                  className="flex-1"
                  disabled={editingSection !== 'testManagement'}
                  max={100}
                  min={0}
                  step={1}
                  value={[Number.isFinite(quarantineThreshold) ? quarantineThreshold : 0]}
                  onValueChange={([value]) => {
                    if (editingSection === 'testManagement') {
                      updateTestManagementConfig({ quarantineThresholdPercentage: value });
                    }
                  }}
                />
                <Input
                  aria-label="Quarantine threshold input"
                  className="w-20"
                  disabled={editingSection !== 'testManagement'}
                  type="number"
                  value={Number.isFinite(quarantineThreshold) ? quarantineThreshold.toString() : ''}
                  onChange={(e) => {
                    if (editingSection !== 'testManagement') return;
                    const raw = e.target.value;
                    updateTestManagementConfig({
                      quarantineThresholdPercentage:
                        raw === '' ? undefined : Number.parseFloat(raw),
                    });
                  }}
                />
              </div>
              {quarantineError && <p className="text-xs text-destructive">{quarantineError}</p>}
              <p className="text-xs text-muted-foreground">
                Tests at or above this score are auto-quarantined (when auto-quarantine is enabled).
              </p>
            </div>
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
              disabled={editingSection !== 'testManagement'}
              checked={autoQuarantineEnabled}
              onCheckedChange={(checked) => {
                if (editingSection === 'testManagement') {
                  updateTestManagementConfig({ autoQuarantineEnabled: checked });
                }
              }}
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="flakiness-min-runs">Minimum Runs for Flakiness Evaluation</Label>
            <Input
              id="flakiness-min-runs"
              disabled={editingSection !== 'testManagement'}
              min={1}
              type="number"
              value={flakinessMinRuns.toString()}
              onChange={(e) => {
                if (editingSection === 'testManagement') {
                  const value = Number.parseInt(e.target.value, 10);
                  if (!Number.isNaN(value) && value >= 1) {
                    updateTestManagementConfig({ flakinessMinRuns: value });
                  }
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              Minimum number of times a test must run before being evaluated for flakiness
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="flakiness-evaluation-window">Evaluation Window (Days)</Label>
            <Input
              id="flakiness-evaluation-window"
              disabled={editingSection !== 'testManagement'}
              min={1}
              type="number"
              value={flakinessEvaluationWindowDays.toString()}
              onChange={(e) => {
                if (editingSection === 'testManagement') {
                  const value = Number.parseInt(e.target.value, 10);
                  if (!Number.isNaN(value) && value >= 1) {
                    updateTestManagementConfig({ flakinessEvaluationWindowDays: value });
                  }
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              Number of days to look back when calculating test flakiness scores
            </p>
          </div>

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
