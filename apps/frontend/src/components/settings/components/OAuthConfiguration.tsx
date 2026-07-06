import {
  OAUTH_PROVIDER_IDS,
  type OAuthProviderId,
  type OAuthProvisioningMode,
  type OAuthSettings,
} from '@playwright-reports/shared';
import { Fingerprint } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { authHeaders } from '@/lib/auth';
import { withBase } from '@/lib/url';
import SettingsSectionHeader from './SettingsSectionHeader';

const PROVIDERS: Array<{ id: OAuthProviderId; name: string; oidc: boolean }> = [
  { id: 'github', name: 'GitHub', oidc: false },
  { id: 'google', name: 'Google', oidc: false },
  { id: 'oidc', name: 'Generic OIDC (Okta, Keycloak, …)', oidc: true },
];

const MODES: Array<{ value: OAuthProvisioningMode; label: string }> = [
  { value: 'invite_only', label: 'Invite only' },
  { value: 'open', label: 'Open (anyone signs up)' },
];

interface ProviderForm {
  enabled: boolean;
  clientId: string;
  mode: OAuthProvisioningMode;
  issuerUrl: string;
  secret: string;
  secretSet: boolean;
  clearSecret: boolean;
  // One domain per line in the textarea; serialized to string[] on save.
  allowedEmailDomains: string;
}

type Forms = Record<OAuthProviderId, ProviderForm>;

function toForms(settings: OAuthSettings): Forms {
  const out = {} as Forms;
  for (const id of OAUTH_PROVIDER_IDS) {
    const p = settings[id];
    out[id] = {
      enabled: p?.enabled ?? false,
      clientId: p?.clientId ?? '',
      mode: p?.mode === 'open' ? 'open' : 'invite_only',
      issuerUrl: p?.issuerUrl ?? '',
      secret: '',
      secretSet: p?.secretSet ?? false,
      clearSecret: false,
      allowedEmailDomains: (p?.allowedEmailDomains ?? []).join('\n'),
    };
  }
  return out;
}

async function fetchSettings(): Promise<OAuthSettings | null> {
  const res = await fetch(withBase('/api/config/sso'), {
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.providers ?? null;
}

export default function OAuthConfiguration() {
  const [forms, setForms] = useState<Forms | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const load = useCallback(async () => {
    const settings = await fetchSettings();
    if (settings) setForms(toForms(settings));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = (id: OAuthProviderId, patch: Partial<ProviderForm>) => {
    setForms((prev) => (prev ? { ...prev, [id]: { ...prev[id], ...patch } } : prev));
  };

  // Cancel discards the draft by re-reading server state.
  const cancel = () => {
    setEditing(false);
    load();
  };

  const save = async () => {
    if (!forms) return;
    setSaving(true);
    const body: Record<string, unknown> = {};
    for (const id of OAUTH_PROVIDER_IDS) {
      const f = forms[id];
      // Send the secret only when changing it: a new value sets it, an explicit
      // clear sends '', and an untouched field is omitted to keep the current one.
      const secretField = f.secret
        ? { clientSecret: f.secret }
        : f.clearSecret
          ? { clientSecret: '' }
          : {};
      body[id] = {
        enabled: f.enabled,
        clientId: f.clientId,
        mode: f.mode,
        allowedEmailDomains: f.allowedEmailDomains
          .split(/[\n,]/)
          .map((d) => d.trim())
          .filter(Boolean),
        ...(PROVIDERS.find((p) => p.id === id)?.oidc ? { issuerUrl: f.issuerUrl } : {}),
        ...secretField,
      };
    }
    const res = await fetch(withBase('/api/config/sso'), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast.error(data.error ?? 'Failed to save SSO settings');
      return;
    }
    toast.success('SSO settings saved');
    if (data.providers) setForms(toForms(data.providers));
    setEditing(false);
  };

  return (
    <Card className="mb-6 p-4">
      <SettingsSectionHeader
        title="Single Sign-On"
        icon={Fingerprint}
        isEditing={editing}
        canEdit={true}
        isUpdating={saving}
        onEdit={() => setEditing(true)}
        onSave={save}
        onCancel={cancel}
      />
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Let users sign in with GitHub, Google, or an OIDC provider. Set the{' '}
          <strong>server base URL</strong> (General settings) so redirect URIs resolve, and register
          each provider's redirect URI with that provider.
        </p>
        {!forms ? (
          <Spinner />
        ) : (
          <Accordion
            type="multiple"
            className="space-y-3"
            defaultValue={OAUTH_PROVIDER_IDS.filter((id) => forms[id].enabled)}
          >
            {PROVIDERS.map(({ id, name, oidc }) => {
              const f = forms[id];
              return (
                <AccordionItem key={id} value={id} className="rounded-lg border px-4">
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex flex-1 items-center justify-between gap-2 pr-2">
                      <span className="font-medium">{name}</span>
                      <Badge variant={f.enabled ? 'success' : 'outline'}>
                        {f.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 pb-4">
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <Label htmlFor={`${id}-enabled`} className="cursor-pointer font-normal">
                        Enable {name} sign-in
                      </Label>
                      <Switch
                        id={`${id}-enabled`}
                        checked={f.enabled}
                        disabled={!editing}
                        onCheckedChange={(checked) => update(id, { enabled: checked })}
                      />
                    </div>

                    <p className="text-xs text-muted-foreground font-mono break-all">
                      Redirect URI: {origin}/api/auth/oauth/{id}/callback
                    </p>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor={`${id}-client-id`}>Client ID</Label>
                        <Input
                          id={`${id}-client-id`}
                          value={f.clientId}
                          disabled={!editing}
                          onChange={(e) => update(id, { clientId: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`${id}-secret`}>Client secret</Label>
                        {f.clearSecret ? (
                          <div className="flex h-9 items-center gap-2 text-sm">
                            <span className="text-muted-foreground">
                              Stored secret will be removed on save.
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => update(id, { clearSecret: false })}
                            >
                              Undo
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Input
                              id={`${id}-secret`}
                              type="password"
                              value={f.secret}
                              disabled={!editing}
                              placeholder={
                                f.secretSet ? '•••••• (leave blank to keep current)' : ''
                              }
                              onChange={(e) => update(id, { secret: e.target.value })}
                            />
                            {editing && f.secretSet && !f.secret && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => update(id, { clearSecret: true, secret: '' })}
                              >
                                Clear
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor={`${id}-mode`}>Provisioning</Label>
                      <Select
                        value={f.mode}
                        disabled={!editing}
                        onValueChange={(value) =>
                          update(id, { mode: value as OAuthProvisioningMode })
                        }
                      >
                        <SelectTrigger id={`${id}-mode`} className="max-w-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MODES.map((m) => (
                            <SelectItem key={m.value} value={m.value}>
                              {m.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor={`${id}-domains`}>Allowed email domains</Label>
                      <Textarea
                        id={`${id}-domains`}
                        value={f.allowedEmailDomains}
                        disabled={!editing}
                        rows={3}
                        placeholder={'acme.com\neng.acme.com'}
                        onChange={(e) => update(id, { allowedEmailDomains: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        One per line. Restricts open sign-up to verified emails on these domains
                        (subdomains included). Leave empty for no restriction. A direct invite
                        always bypasses this.
                      </p>
                    </div>

                    {oidc && (
                      <div className="space-y-1">
                        <Label htmlFor={`${id}-issuer`}>Issuer URL</Label>
                        <Input
                          id={`${id}-issuer`}
                          value={f.issuerUrl}
                          disabled={!editing}
                          placeholder="https://your-org.okta.com"
                          onChange={(e) => update(id, { issuerUrl: e.target.value })}
                        />
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}
