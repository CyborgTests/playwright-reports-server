# Authentication

Auth is off until you turn it on. Once it's on, it covers the UI, the API, served reports, and the api keys you can use for CI or CLI.

## On or off

environment variable `API_TOKEN`.

- **Unset** -> open mode. No login, everyone is an admin. Fine on your laptop.
- **Set to anything** -> auth is on. Login required, and roles/users/invites/API keys all appear.
In open mode the auth tables and `/api/auth/*` endpoints just sit there (they 404), and nothing auth-related touches the request path. So leaving it off costs nothing except, you know, a bit of security (however, some people say the role of cybersecurity is overstated).

## Setting up the first admin

Turn auth on with no users in the database and the server starts in "setup" mode.

1. On the setup screen, type the `API_TOKEN` value plus the username and password you want for the first admin.
2. Done. When admin is created, setup is locked (until db is persisted).

Everyone after that gets in by [invite](#invites).

## Roles

| Role | See things | Edit content | Make your own API keys | Manage config, users, invites |
|------|:----------:|:------------:|:----------------------:|:-----------------------------:|
| **admin** | yes | yes | yes (incl. shared service keys) | yes |
| **member** | yes | yes | yes | no |
| **readonly** | yes | no | no | no |

- **admin** runs the server: LLM/GitHub-Sync/notification settings, users, invites, all of that.
- **member** does the actual work - edit reports, tests, failure clusters, LLM analysis; run GitHub Sync; make their own API keys.
- **readonly** looks but doesn't touch. This is what every new account gets at start, on purpose.

Under the hood it's capability-based, not three hardcoded roles - `packages/shared/src/access.ts` has the default matrix if you want to see exactly which action maps to which role. Admins can override which roles hold each capability in **Settings -> Access Control** (`admin` always keeps every capability).

## Users

Admins manage people in **Settings -> Users**:

- **Change role** - promote, demote.
- **Disable** - user can't log in, and their sessions and personal API keys stop working immediately.
- **Delete** - removes user, sessions and personal keys.
- **Reset password** - gives a one-time reset token (valid for 24 hours) to give the user who, inevitably, forgot password.

There are also two "nuances":

- You cannot disable/delete the **last remaining admin**. Someone has to hold the keys.
- You cannot update [break-glass root account](#break-glass-root-account) via API. Works with env vars only.

## Invites

By default you can't just sign yourself up - onboarding is invite-only. Admins hand out invites in **Settings -> Invites**:

- An invite is a one-time code, with an optional expiry and an optional cap on how many times it could be used.
- Whoever redeems it lands as **readonly**. Admin promotes them afterward.
- Revoke any invite whenever, used or not.

People redeem invites on the register screen with the code plus a username and password of their choosing.

However, you can set **Allow open registration** at **Settings -> Server** and anyone with the URL can sign themselves up. The role open-registration accounts receive is configurable (`readonly` / `member` / `admin`) - default `readonly`.

## Sessions

Logging in creates a server-side session, with 2 cookies on UI:

| Cookie | Notable flags | Job |
|--------|---------------|-----|
| `pwrs_session` | httpOnly, sameSite=lax, secure* | The session token. Only its hash lives on the server. |
| `pwrs_csrf` | sameSite=lax, secure* | CSRF token - JS reads it and echoes it back in the `x-csrf-token` header on writes. |

<sub>*`secure` tracks [`COOKIE_SECURE`](./Configuration#authorization) (default `true`). Turn it off only for plain HTTP, otherwise the browser quietly throws the cookie away and you'll wonder why login "doesn't work".</sub>

- **Idle timeout**: `UI_AUTH_EXPIRE_HOURS`, default **12**. It slides - using the app pushes it back out (at most once every 5 minutes).
- **Hard limit**: 30 days. The sliding refresh can't push past it. After 30 days you have to log in again.
- **CSRF**: any write (POST/PUT/PATCH/DELETE) made with a session cookie has to echo the `pwrs_csrf` value back in the header. API keys don't carry cookies, so they skip this.
- **Passwords**: hashed with scrypt - salted, memory-hard, never stored or logged in plaintext.

Users change their own password from the account menu, which also logs out all their other sessions.

## API keys

For non-human callers - playwright reporter uploading reports or [`pwrs-cli`](./Code-Assistant) fetching data. Keys use plain `Authorization: Bearer <key>` header - no cookies or CSRF.

Created in **Settings -> API Keys**. You see the actual key **once**, at creation - copy it then, because only the hash is kept.

A few things worth knowing:

- API keys are intentionally limited in what they have access to. No key can change settings, manage users, or directly call backend routes.
- Members and admins can create their own api-keys; readonly users - not.
- Admins see and can revoke *everyone's* keys (with the owner's name attached). Everyone else sees only their own keys.
- **Service keys** are admin-only and have no owner, so they outlive whoever created them - use these for shared CI credentials. Personal keys are deleted with their owner.
- **Expiry** - a key can carry an expiration date; it stops working after it. Leave it unset for a non-expiring key.
- The lists in **Settings -> API Keys** (and Users / Invites) are paginated and hide revoked or disabled entries by default - use the per-list **Show revoked / Show disabled** toggle to see them.

## Share links

Admins can hand a report to someone with **no account**, even when auth is on. A **Share** button on the served report creates a read-only "share" API key and copies a link that opens just that report. Members can reuse an existing share token; only admins mint them. Auto-created share tokens expire in 24h - for a longer-lived link, create a dedicated service key with a longer expiry.

## Audit log

Every login, role change, and key/invite action is recorded in an `auth_audit` trail. Admins read it in the collapsible **Settings -> Audit Log** section.

## Break-glass root account

For the case every admin is locked out:

- Set **both** `ROOT_USERNAME` and `ROOT_PASSWORD`. On boot you get an emergency admin (`id: root`) that logs in like anyone else.
- It ignores the user-management endpoints completely - it lives and dies by those two env vars.
- If the username collides with a real user, break-glass just switches off rather than hijacking the account.
- Unset both vars once you're back in, and it disappears on the next boot.

Don't leave it running.

## Single sign-on (GitHub, Google, OIDC)

Optional. Let people sign in with GitHub, Google, or any OIDC provider (Okta, Keycloak, and friends) instead of a username and password. Admins turn it on per provider in **Settings -> Single Sign-On**; it's hidden in open mode like everything else.

Setup, per provider:

1. Set the **server base URL** in **Settings -> General**. SSO needs it to build the redirect URI, and it has to be the real, externally reachable URL (https in production, or the browser will drop cookies on the way back).
2. Register an OAuth app with the provider and point its redirect/callback URL at the one shown in the SSO settings: `<server base url>/api/auth/oauth/<provider>/callback`.
3. Paste the client id and secret into the SSO section. For OIDC, also paste the issuer URL (the thing with `/.well-known/openid-configuration` under it). The secret is write-only: stored encrypted, never shown back.
4. Pick a provisioning mode and enable it.

Provisioning mode decides what happens the first time someone shows up via a provider:

| Mode | First-time sign-in |
|------|--------------------|
| **Disabled** | Provider off. |
| **Invite only** | They must carry a valid invite code through the flow (the register screen passes it along). No invite, no entry. |
| **Open** | Anyone who authenticates with the provider gets an account, as a **member**. |

A few things worth knowing:

- **No passwords stored for SSO users.** A pure-SSO account has no password, so "Change password" just isn't shown for them.
- **Linking.** If a provider hands back a verified email that matches an existing account, the identity is auto-linked to it - but **only after the provisioning gate passes** (a valid invite in *invite only*, or an allowed email domain in *open*), so an unverified or off-list sign-in can't absorb an existing account. Otherwise you can link providers yourself from the account menu's **Connected accounts**, and unlink them again. The server won't let you unlink your last sign-in method (no password and no other provider) and lock yourself out.
- **Email is only trusted when the provider says it's verified.** Unverified email is treated as no email, so it can't auto-link to anyone.
- **Email-domain allowlist.** Each provider can restrict open sign-up to a list of verified email domains (subdomains included). With an allowlist set, an unverified or off-list email is rejected - but a direct invite always bypasses it.
- **Tokens aren't kept.** The provider's access token is used once to read the profile and then thrown away. We don't act on your behalf, so there's nothing to store.
- **Reporters and the CLI don't use SSO** - those keep using API keys. SSO is for humans clicking buttons.

Note: an open-mode SSO account lands as `member` (can edit content), which is a notch above a password self-signup (`readonly`). If that's not what you want, drop the new user back to `readonly` in **Settings -> Users**, or use invite-only.

## See also

- [Configuration](./Configuration) - the env vars behind all this (`API_TOKEN`, `AUTH_SECRET`, `UI_AUTH_EXPIRE_HOURS`, `COOKIE_SECURE`, `ROOT_*`).
- [Code assistant integration](./Code-Assistant) - pointing `pwrs-cli` at a `cli` key.
- [Uploading reports](./Uploading-Reports) - using a `reporter` key in CI.
