# GitHub Sync

A scheduled fetcher that pulls Playwright report artifacts out of a GitHub Actions workflow and uploads them as native reports. Use it when your CI already produces `playwright-report` artifacts and you'd rather not edit the workflow file again because of security policies or religious beliefs.  

Configured from `Settings -> Schedules -> GitHub Sync`. You can run multiple syncs side by side, each pointing at a different repo with its own schedule and token. They don't interfere with each other.

## Setting up a sync

Each entry has these fields:

| Field | What you put there |
|-------|--------------------|
| Name | Whatever helps you recognize it in the list. |
| Repository | `owner/name`. |
| Workflow file | Just filename, e.g. `playwright.yml`. |
| GitHub token | Optional per-config token. Stored encrypted. If blank, falls back to the `GITHUB_TOKEN` env var. |
| Start date & time | Workflow runs before this point get ignored. Helpful when you do not want to sync everything. |
| Cron schedule | Standard cron expression. Each config has its own job. |
| Artifact name regex | Filters which artifacts to upload. Capture groups become `${match1}`, `${match2}`, etc. below. |
| Project name template | Produces the report's `project` field. Mix literal text with placeholders. |
| Report title template | Produces the report's display title. |
| Enabled | Unchecking does not schedule the job. |

## Template placeholders

Available everywhere the UI says "template":

| Placeholder | What it means |
|-------------|---------------|
| `${match1..N}` | Capture groups from the artifact name regex |
| `${branch}` | `head_branch` from the workflow run |
| `${runDate}` | First 10 chars of the run's `created_at` (YYYY-MM-DD) |
| `${runId}` | GitHub workflow run id |
| `${artifactName}` | Raw artifact name returned by GitHub |
| `${workflowName}` | Workflow display name |
| `${workflowFile}` | Workflow filename |
| `${repo}` | `owner/name` from the config |

### Example

You have same workflow for `dev` and `qa` environments.  
Artifacts are `playwright-report-dev-chrome` and `playwright-report-qa-chrome`, so we can match with regex:  
`^playwright-report-(.+)-(.+)$`.
`match1` would be your env name, `match2` would be the browser.
So we can use it for project template: `${match1}:${match2}`, and have projects `dev:chrome` and `qa:chrome`.  

## What permissions the token needs

Read-only.  

- **Fine-grained PAT (recommended):** `Actions: Read-only` on the target repo. `Metadata: Read-only` is granted automatically.
- **Classic PAT:** `repo` for private repos, or `public_repo` for public. Yes, that's more access than necessary; that's classic PAT for you.

If you leave the token field blank in the UI, the server falls back to the `GITHUB_TOKEN` env var. Convenient for a "shared" setup; less convenient if it turns out to be over-scoped, so prefer per-config PATs in anything serious.

Local dev with the `gh` CLI:

```bash
export GITHUB_TOKEN="$(gh auth token)"
```

## What you'll see

On each cron tick, the sync lists workflow runs since the start date, filters artifacts by the regex, skips anything it's already imported (so it's safe to re-run), downloads what's left, and uploads each as a native report. Templates resolve per artifact. Storage backend (`fs` / `s3` / `azure`) is whatever you configured globally; sync is just a producer.

## Common setups

**Per-browser projects on one workflow.** Use `^playwright-report-(chrome|firefox|webkit)$` and template `${match1}`. Three projects emerge automatically, no per-browser config.

**Branch-segregated reports.** Template `${branch}` (or `${match1}:${branch}`) so PR runs and main runs land in different projects. PR noise stops drowning your main-branch trends.

**Backfill.** Set Start date far in the past and save. The next tick imports everything matching since then.

## See also

- [Configuration](./Configuration): `GITHUB_TOKEN`, `AUTH_SECRET` (the key used to encrypt stored per-config tokens)
- [Uploading reports](./Uploading-Reports): the upload path GitHub Sync uses underneath
