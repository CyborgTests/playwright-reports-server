import {
  OAUTH_PROVIDER_IDS,
  type OAuthProviderId,
  type OAuthProvisioningMode,
  type OAuthSettings,
} from '@playwright-reports/shared';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { authHeaders } from '@/lib/auth';
import { withBase } from '@/lib/url';

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

  const save = async () => {
    if (!forms) return;
    setSaving(true);
    const body: Record<string, unknown> = {};
    for (const id of OAUTH_PROVIDER_IDS) {
      const f = forms[id];
      body[id] = {
        enabled: f.enabled,
        clientId: f.clientId,
        mode: f.mode,
        ...(PROVIDERS.find((p) => p.id === id)?.oidc ? { issuerUrl: f.issuerUrl } : {}),
        ...(f.secret ? { clientSecret: f.secret } : {}),
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
  };

  return (
    <Card className="mb-6 p-4">
      <CardHeader className="flex flex-col gap-1 pb-2">
        <h2 className="text-xl font-semibold">Single Sign-On</h2>
        <p className="text-sm text-muted-foreground">
          Let users sign in with GitHub, Google, or an OIDC provider. Set the{' '}
          <strong>server base URL</strong> (General settings) so redirect URIs resolve, and register
          each provider's redirect URI with that provider.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {!forms ? (
          <Spinner />
        ) : (
          <>
            {PROVIDERS.map(({ id, name, oidc }) => {
              const f = forms[id];
              return (
                <div key={id} className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">{name}</h3>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={f.enabled}
                        onChange={(e) => update(id, { enabled: e.target.checked })}
                      />
                      Enabled
                    </label>
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
                        onChange={(e) => update(id, { clientId: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`${id}-secret`}>Client secret</Label>
                      <Input
                        id={`${id}-secret`}
                        type="password"
                        value={f.secret}
                        placeholder={f.secretSet ? '•••••• (leave blank to keep current)' : ''}
                        onChange={(e) => update(id, { secret: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor={`${id}-mode`}>Provisioning</Label>
                    <select
                      id={`${id}-mode`}
                      className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                      value={f.mode}
                      onChange={(e) =>
                        update(id, { mode: e.target.value as OAuthProvisioningMode })
                      }
                    >
                      {MODES.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {oidc && (
                    <div className="space-y-1">
                      <Label htmlFor={`${id}-issuer`}>Issuer URL</Label>
                      <Input
                        id={`${id}-issuer`}
                        value={f.issuerUrl}
                        placeholder="https://your-org.okta.com"
                        onChange={(e) => update(id, { issuerUrl: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            <Button onClick={save} disabled={saving}>
              {saving && <Spinner className="mr-2 h-4 w-4" />}
              Save SSO settings
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
