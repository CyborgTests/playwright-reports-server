# Notifications

Notifications and summaries for Slack and generic webhooks. **Off by default.** Configure in `Settings -> Notifications`.

- **Event rules** fire as soon as a report finishes uploading and matches your condition.
- **Schedule rules** fire on a cron and send summary over a time window (per project).

## Channels

A channel is a delivery target. Each channel has its own type, transport config, and a list of rules.

| Type | Sends to | Payload |
|------|----------|---------|
| **Slack** | Incoming webhook URL | Block Kit JSON (`{ blocks: [...] }`) |
| **Webhook** | Any HTTPS endpoint | Your rendered JSON body, optional HMAC signature, optional custom headers |

Add a channel from `Settings -> Notifications -> Add channel`. The URL is validated (must be `https://`).

**Slack setup**: install the [Incoming WebHooks app](https://slack.com/apps/A0F7XDUAZ-incoming-webhooks) in your workspace, pick a channel, and paste the generated webhook URL. That's it - the destination channel and workspace are encoded in the URL itself.  

**Webhook setup**: URL, optional headers, optional HMAC key. If you set an HMAC key, every request gets `X-PWRS-Signature: sha256=<hex>` computed over the body - verify on your end before trusting the payload.

Per-channel **circuit breaker**: 5 consecutive failures opens the breaker for 5 minutes; during that window dispatches are logged with `skipReason=circuit_open` and not retried. One success closes it again.

## Rules

A channel can have any number of rules. Each rule is one of two kinds (for now).

### Event rules (on report upload)

| Field | Meaning |
|-------|---------|
| **Condition** | `always`, `has_failures`, `pass_rate_below_100`, `recovered_to_clean`, `recovered_no_hard_failures` |
| **Project filter** | `all`, single project name, or regex pattern |
| **Template** | Per-rule override (Slack blocks or webhook JSON body) |

Conditions explained:

- `has_failures` - at least one unexpected failure
- `pass_rate_below_100` - any failed **or** flaky
- `recovered_to_clean` - previous report had failures or flakes, this one has none (full recovery)
- `recovered_no_hard_failures` - previous had hard failures, this one has none (if test retried and is flaky, but still passes - that would be our little secret *wink*)

**De-dup**: within a single channel, only the **first matching rule per report** fires. Subsequent matches are logged with `skipReason=duplicate`. So order matters - put the most-specific rules first.

### Schedule rules (cron digests)

For a case when you use a channel just for failures, but still want that pretty daily/weekly summary that tests are running.

| Field | Meaning |
|-------|---------|
| **Cadence** | `daily` (HH:MM), `weekly` (HH:MM, Monday), or raw `cron` expression |
| **Window** | `last_24h`, `last_7d`, `last_14d`, `since_last_send` |
| **Condition** | `always`, `all_clean`, `no_hard_failures` |
| **Project filter** | Same as event rules |

Window semantics:

- The standard windows (`last_24h` / `last_7d` / `last_14d`) are exactly what they say.
- `since_last_send` looks at everything since the last successful delivery of *this* rule *for this project*. First fire defaults to 24h. Capped at 14 days as a safety ceiling.

Schedule rules **fan out by project**: the scheduler discovers which projects had activity in the window, then sends one digest per project with that project's stats. Projects with no activity in the window are logged as `skipReason=no_activity` and skipped.

## Templates and variables

Templates use a small **Mustache** subset:

```
{{var}}                substitution
{{.}}                  current section value (when iterating)
{{#var}}…{{/var}}      section: render once if truthy / iterate if array
{{^var}}…{{/var}}      inverted: render only when missing/empty
{{!comment}}           ignored
```

Deliberately **not** supported: partials, unescaped <code v-pre>{{{ }}}</code>, delimiter changes, lambdas. Parser refuses templates nested deeper than 32 sections.

### Variable allowlist

Only variables in the rule's allowlist render. Unknown names render as literal `{{whatever}}` and show as warnings in the preview.

**Event rule variables** (any condition):

`project`, `reportId`, `displayNumber`, `reportTitle`, `reportUrl`, `timestamp`, `passed`, `failed`, `flaky`, `skipped`, `total` (executed), `totalWithSkipped`, `passRate`, `duration`, `durationMs`

**Recovery-only additions** (`recovered_*` conditions):

`prevReportId`, `prevDisplayNumber`, `prevPassRate`, `prevPassed`, `prevFailed`, `prevFlaky`, `prevSkipped`, `prevTotal`, `prevTotalWithSkipped`, `compareUrl`

**Schedule rule variables**:

`windowStart`, `windowEnd`, `windowLabel`, `cadence`, `reportCount`, `projectCount`, `totalPassed`, `totalFailed`, `totalFlaky`, `totalSkipped`, `passRate`, `passRateDelta`, `regressionsCount`, `recoveriesCount`, `topFailureCategories` (iterable), `topFailingTests` (iterable), `flakiestTests` (iterable), `worstProjects` (iterable), `project`, `dashboardUrl`

### Slack templates (Block Kit)

Build messages in the block editor - Header / Section / Context / Divider / Actions (buttons) / Image. Each block's text supports Slack mrkdwn (`*bold*`, `_italic_`, `` `code` ``, `<url|label>`) and Mustache. The right-hand preview pane renders the actual Block Kit you'll get, with sample data filled in.

Defaults are shipped per condition (e.g. a red 🔴 header for `has_failures`, a 🎉 header for `recovered_to_clean`). Edit-then-restore via the "Reset to default" button if you want to get back to the defaults later.

### Webhook templates (JSON)

You write the entire request body as a JSON template. Variable values are **JSON-escaped** automatically - `{{reportTitle}}` inside a string field renders escape-clean even if the title has quotes or newlines. Templates over 20 KB are rejected at validation time.

Example minimal webhook body:

```json
{
  "project": "{{project}}",
  "report": "{{reportUrl}}",
  "passRate": {{passRate}},
  "failed": {{failed}}
}
```

The rendered output is parsed as JSON before sending - if it doesn't parse, the dispatch fails with a clear error instead of producing a broken POST.

## Reliability

- **Retries**: 3 attempts (initial + 2 backoffs at 1s and 4s). 4xx responses fail fast (no retries on client errors). `Retry-After` is respected when present.
- **Per-attempt timeout**: 5 seconds.
- **Circuit breaker**: per-channel, 5 consecutive failures -> 5 minutes open.
- **Server Base URL** required for `reportUrl`/`compareUrl`/`dashboardUrl` to be absolute and clickable. Set it in `Settings -> Server Configuration`. Slack will reject relative URLs in buttons.
- **Schedule misfires**: schedules run on the standard cron service with `protect: true` - a still-running job won't double-fire on the next tick.

## Delivery log

`Settings -> Notifications -> Delivery log` shows every dispatch attempt with channel, rule, status, HTTP code, attempt count, error excerpt, and a `source` flag (`live` vs `test`). Filter by status (success / failed / skipped) and by channel. Entries older than the configured retention are pruned by the cron service.

**Skip reasons you can find:**

- `circuit_open` - breaker is open, dispatch suppressed
- `no_activity` - schedule rule fired but no reports fell in the window
- `condition_unmet` - schedule condition (e.g. `all_clean`) didn't match
- `duplicate` - earlier rule on the same channel already fired for this report
- `empty_render` - template produced empty output

## Test send

The "Send test" panel lets you fire a rule manually against either:

- A specific real report (event rules only - picks variables from that report's stats)
- A synthetic sample (schedule rules, or event rules when you don't have a matching report)

Results are written to the delivery log with `source=test`, so you can see exactly what landed in Slack vs what was rendered.

## Secret handling

Sensitive fields - Slack URL, webhook URL, custom header values, HMAC key - are masked when the config is read back.
On save, fields are left untouched (the previously-stored secret stays in place). The schema explicitly **rejects** partial edits that contain the mask sentinel as a substring, so a half-edited masked field can't silently corrupt the stored credential.

## Troubleshooting

- **Slack 400 with "no_text"**: at least one of your blocks must contain non-empty text after rendering. An entirely empty digest will be rejected by Slack - usually means the variable allowlist mismatch produced an empty section.
- **Slack 400 with "invalid_blocks"**: a button URL didn't render to an absolute `https://` (Server Base URL is unset, or the template references a recovery-only variable from a non-recovery condition).
- **Webhook signature mismatch on your side**: signature is computed over the **exact body bytes** as sent (`Content-Type: application/json; charset=utf-8`).
- **Schedule rule fires but log shows `no_activity`**: nothing matched the project filter inside the window. Widen the window or check the filter regex.
- **Schedule rule misses a day**: check the cron expression - schedules run in the server's local timezone. The next-fire time is printed to the server log when the scheduler reloads.
- **Test send returns 400 immediately**: usually a validation error on the rule body (e.g. invalid cron) - the error message identifies the failing field.
