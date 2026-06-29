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

export function can(role: Role | null | undefined, capability: Capability): boolean {
  return role != null && ACCESS_MATRIX[capability].includes(role);
}

const CONTENT_CAPS: readonly Capability[] = [
  CAPABILITIES.contentReports,
  CAPABILITIES.contentResults,
  CAPABILITIES.contentTests,
  CAPABILITIES.contentLlm,
  CAPABILITIES.contentClusters,
  CAPABILITIES.contentFeedback,
];

// API keys never get config/admin/operational capabilities — those are session-only.
export function scopeGrants(
  scopes: readonly KeyScope[],
  capability: KeyCapability
): readonly Capability[] {
  const out = new Set<Capability>();
  if (scopes.includes(KEY_SCOPES.cli)) {
    out.add(CAPABILITIES.view);
    if (capability === KEY_CAPABILITIES.content) for (const c of CONTENT_CAPS) out.add(c);
  }
  if (scopes.includes(KEY_SCOPES.upload)) {
    // The reporter's workflow includes GET /api/tests?status=quarantined (view-gated).
    out.add(CAPABILITIES.view);
    if (capability === KEY_CAPABILITIES.content) {
      out.add(CAPABILITIES.contentReports);
      out.add(CAPABILITIES.contentResults);
    }
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
