import {
  CAPABILITIES,
  type Capability,
  EDITABLE_ROLES,
  type Role,
  resolveAccessMatrix,
  type ServerConfig,
} from '@playwright-reports/shared';
import { ShieldCheck } from 'lucide-react';
import { Fragment } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import type { EditableSettingsSection } from '../types';
import SettingsSectionHeader from './SettingsSectionHeader';

const CAPABILITY_GROUPS = (() => {
  const order: string[] = [];
  const byGroup: Record<string, Capability[]> = {};
  for (const capability of Object.values(CAPABILITIES) as Capability[]) {
    const name = capability.includes(':') ? capability.split(':')[0] : 'general';
    if (!byGroup[name]) {
      byGroup[name] = [];
      order.push(name);
    }
    byGroup[name].push(capability);
  }
  return order.map((name) => ({ group: name, capabilities: byGroup[name] }));
})();

const CAPABILITY_DESCRIPTIONS: Record<Capability, string> = {
  view: 'Read the dashboard, reports, analytics, and test data',
  'content:reports': 'Generate, edit, and delete reports',
  'content:results': 'Delete uploaded results',
  'content:tests': 'Edit test metadata, quarantine, and root-cause category',
  'content:llm': 'Run LLM analysis and manage models/groups',
  'content:clusters': 'Resolve and edit failure clusters',
  'content:feedback': 'Add and edit analysis feedback',
  'config:server': 'Change server, branding, cron, and registration settings',
  'config:llm': 'Change LLM configuration',
  'config:githubSync': 'Change GitHub sync configuration',
  'config:notifications': 'Change notification settings',
  'config:sso': 'Change SSO / OAuth settings',
  'manage:users': 'Create, edit, disable, and delete users',
  'manage:invites': 'Create and revoke invites',
  'manage:qualityDashboards': 'Create and edit quality dashboards',
  'apiKeys:service': 'Manage shared service API keys',
  'apiKeys:own': 'Create and manage your own API keys',
  'run:githubSync': 'Trigger GitHub sync runs',
  'test:llmModel': 'Test LLM model connections',
  'test:notifications': 'Send test notifications',
};

interface AccessControlConfigurationProps {
  tempConfig: ServerConfig;
  editingSection: EditableSettingsSection;
  isUpdating: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onUpdateTempConfig: (updates: Partial<ServerConfig>) => void;
}

export default function AccessControlConfiguration({
  tempConfig,
  editingSection,
  isUpdating,
  onEdit,
  onSave,
  onCancel,
  onUpdateTempConfig,
}: Readonly<AccessControlConfigurationProps>) {
  const editing = editingSection === 'access';
  const effective = resolveAccessMatrix(tempConfig.accessMatrix);

  const toggle = (capability: Capability, role: Role, checked: boolean) => {
    if (!editing) return;
    const current = effective[capability].filter((existingRole) =>
      EDITABLE_ROLES.includes(existingRole)
    );
    const next = checked
      ? [...new Set([...current, role])]
      : current.filter((existingRole) => existingRole !== role);
    onUpdateTempConfig({ accessMatrix: { ...tempConfig.accessMatrix, [capability]: next } });
  };

  return (
    <Card id="access" className="mb-6 scroll-mt-20 p-4">
      <SettingsSectionHeader
        title="Access Control"
        icon={ShieldCheck}
        isEditing={editing}
        canEdit={editingSection === 'none'}
        isUpdating={isUpdating}
        onEdit={onEdit}
        onSave={onSave}
        onCancel={onCancel}
      />
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Which role may use each capability. <span className="font-medium">view</span> is the only
          read gate; every other capability grants a specific action.{' '}
          <span className="font-medium">admin</span> always has every capability and cannot be
          changed - so an access change can never lock you out.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Capability</th>
                <th className="px-3 py-2 font-medium">admin</th>
                <th className="px-3 py-2 font-medium">member</th>
                <th className="px-3 py-2 font-medium">readonly</th>
              </tr>
            </thead>
            <tbody>
              {CAPABILITY_GROUPS.map(({ group, capabilities }) => (
                <Fragment key={group}>
                  <tr className="bg-muted/40">
                    <td
                      colSpan={4}
                      className="px-1 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {group}
                    </td>
                  </tr>
                  {capabilities.map((capability) => (
                    <tr key={capability} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <div>{CAPABILITY_DESCRIPTIONS[capability]}</div>
                        <div className="font-mono text-xs text-muted-foreground">{capability}</div>
                      </td>
                      <td className="px-3 py-2">
                        <Checkbox checked disabled aria-label={`admin: ${capability}`} />
                      </td>
                      {EDITABLE_ROLES.map((role) => (
                        <td key={role} className="px-3 py-2">
                          <Checkbox
                            checked={effective[capability].includes(role)}
                            disabled={!editing}
                            aria-label={`${role}: ${capability}`}
                            onCheckedChange={(checked) =>
                              toggle(capability, role, checked === true)
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
