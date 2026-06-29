// Authorization source of truth, shared by backend guards and the UI. A session
// is authorized by role via ACCESS_MATRIX; an API key by scope × capability via
// scopeGrants(). Open mode resolves to a synthetic `admin`.

export const ROLES = {
  admin: 'admin',
  member: 'member',
  readonly: 'readonly',
} as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

export const KEY_SCOPES = {
  upload: 'upload',
  cli: 'cli',
  share: 'share',
} as const;
export type KeyScope = (typeof KEY_SCOPES)[keyof typeof KEY_SCOPES];

export const KEY_CAPABILITIES = {
  read: 'read',
  content: 'content',
} as const;
export type KeyCapability = (typeof KEY_CAPABILITIES)[keyof typeof KEY_CAPABILITIES];

// User-facing presets; each maps to a fixed scope × capability (see routes/apiKeys.ts).
export const KEY_TYPES = {
  reporter: 'reporter',
  cli: 'cli',
  share: 'share',
} as const;
export type KeyType = (typeof KEY_TYPES)[keyof typeof KEY_TYPES];

export const CAPABILITIES = {
  view: 'view',
  contentReports: 'content:reports',
  contentResults: 'content:results',
  contentTests: 'content:tests',
  contentLlm: 'content:llm',
  contentClusters: 'content:clusters',
  contentFeedback: 'content:feedback',
  shareReports: 'content:share',
  configServer: 'config:server',
  configLlm: 'config:llm',
  configGithubSync: 'config:githubSync',
  configNotifications: 'config:notifications',
  configSso: 'config:sso',
  manageUsers: 'manage:users',
  manageInvites: 'manage:invites',
  manageQualityDashboards: 'manage:qualityDashboards',
  apiKeysService: 'apiKeys:service',
  apiKeysOwn: 'apiKeys:own',
  runGithubSync: 'run:githubSync',
  testLlmModel: 'test:llmModel',
  testNotifications: 'test:notifications',
} as const;
export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

const ADMIN_ONLY: readonly Role[] = [ROLES.admin];
const ADMIN_OR_MEMBER: readonly Role[] = [ROLES.admin, ROLES.member];
const VIEWERS: readonly Role[] = [ROLES.admin, ROLES.member, ROLES.readonly];

export const ACCESS_MATRIX: Record<Capability, readonly Role[]> = {
  view: VIEWERS,
  'content:reports': ADMIN_OR_MEMBER,
  'content:results': ADMIN_OR_MEMBER,
  'content:tests': ADMIN_OR_MEMBER,
  'content:llm': ADMIN_OR_MEMBER,
  'content:clusters': ADMIN_OR_MEMBER,
  'content:feedback': ADMIN_OR_MEMBER,
  'content:share': ADMIN_OR_MEMBER,
  'config:server': ADMIN_ONLY,
  'config:llm': ADMIN_ONLY,
  'config:githubSync': ADMIN_ONLY,
  'config:notifications': ADMIN_ONLY,
  'config:sso': ADMIN_ONLY,
  'manage:users': ADMIN_ONLY,
  'manage:invites': ADMIN_ONLY,
  'manage:qualityDashboards': ADMIN_ONLY,
  'apiKeys:service': ADMIN_ONLY,
  'apiKeys:own': ADMIN_OR_MEMBER,
  'run:githubSync': ADMIN_OR_MEMBER,
  'test:llmModel': ADMIN_OR_MEMBER,
  'test:notifications': ADMIN_OR_MEMBER,
};

export const EDITABLE_ROLES: readonly Role[] = [ROLES.member, ROLES.readonly];

export type AccessMatrixOverrides = Partial<Record<Capability, readonly Role[]>>;

export function resolveAccessMatrix(
  overrides?: AccessMatrixOverrides
): Record<Capability, readonly Role[]> {
  const out = {} as Record<Capability, readonly Role[]>;
  for (const capability of Object.keys(ACCESS_MATRIX) as Capability[]) {
    const override = overrides?.[capability];
    out[capability] = override
      ? [ROLES.admin, ...override.filter((role) => role !== ROLES.admin)]
      : ACCESS_MATRIX[capability];
  }
  return out;
}

export function can(
  role: Role | null | undefined,
  capability: Capability,
  matrix: Record<Capability, readonly Role[]> = ACCESS_MATRIX
): boolean {
  if (role === ROLES.admin) return true;
  return role != null && matrix[capability].includes(role);
}

export function capabilitiesFor(
  role: Role | null | undefined,
  matrix: Record<Capability, readonly Role[]> = ACCESS_MATRIX
): Capability[] {
  return (Object.keys(matrix) as Capability[]).filter((capability) =>
    can(role, capability, matrix)
  );
}

const CONTENT_CAPABILITIES: readonly Capability[] = [
  CAPABILITIES.contentReports,
  CAPABILITIES.contentResults,
  CAPABILITIES.contentTests,
  CAPABILITIES.contentLlm,
  CAPABILITIES.contentClusters,
  CAPABILITIES.contentFeedback,
];

// API keys never get config/admin/operational capabilities - those are session-only.
export function scopeGrants(
  scopes: readonly KeyScope[],
  capability: KeyCapability
): readonly Capability[] {
  const out = new Set<Capability>();
  if (scopes.includes(KEY_SCOPES.cli)) {
    out.add(CAPABILITIES.view);
    if (capability === KEY_CAPABILITIES.content)
      for (const contentCapability of CONTENT_CAPABILITIES) out.add(contentCapability);
  }
  if (scopes.includes(KEY_SCOPES.upload)) {
    // The reporter's workflow includes GET /api/tests?status=quarantined (view-gated).
    out.add(CAPABILITIES.view);
    if (capability === KEY_CAPABILITIES.content) {
      out.add(CAPABILITIES.contentReports);
      out.add(CAPABILITIES.contentResults);
    }
  }
  if (scopes.includes(KEY_SCOPES.share)) {
    out.add(CAPABILITIES.view);
  }
  return [...out];
}

export function keyCan(
  scopes: readonly KeyScope[],
  capability: KeyCapability,
  needed: Capability
): boolean {
  return scopeGrants(scopes, capability).includes(needed);
}
