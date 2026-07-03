# Test management & quarantine

Watch how stable each test is over time, and (optionally) skip the noisiest ones at runtime so they stop blocking CI and training your team to ignore failures.

Configured from `Settings -> Test Management`.

## What "flaky" means here

Flakiness is a **status instability**, not raw fail rate. A test that fails every single run is broken, not flaky, and gets scored `0%`. A test that ping-pongs between pass and fail is considered flaky, and its score climbs toward `100%`.

## Settings

| Setting | Default | What it does |
|---------|---------|--------------|
| Warning Threshold (%) | `2` | Score above this puts the test in the "Flaky" tier (yellow). |
| Quarantine Threshold (%) | `5` | Score above this is "Critical" (red), and triggers auto-quarantine if you've turned it on. |
| Auto-Quarantine Tests | `false` | When on, tests crossing the quarantine threshold are quarantined automatically. The reason references the score. |
| Minimum Runs for Evaluation | `1` | Below this many runs in the window, no score is computed. Raise to `5` or `10` on noisy projects so a fresh test bad run doesn't immediately label a test "Critical". |
| Evaluation Window (Days) | `30` | Let's have a bit of forgiveness at least somewhere. |

Tiers shown in the UI:

| Tier | Score | Badge |
|------|-------|-------|
| Stable | 0 -> Warning | Green |
| Flaky | Warning -> Quarantine | Yellow |
| Critical | Quarantine+ | Red |

> Not sure your thresholds are right? Leave **Auto-Quarantine** off and observe for ~ a week. Once the tiers look like they're telling you the truth - smash that checkbox.

## Manual vs auto quarantine

Same runtime effect (the reporter skips the test). Different provenance.

- **Auto** sets a reason that mentions the score (so you know later why this test ended up there).
- **Manual** lets you pin a free-text reason. Use this for things like "flake under investigation, see PR #1234" or "this lives here until Q3, do not touch".

Both are reversible from the UI. Auto-quarantine doesn't lock you in; the un-quarantine button is right next to the test.

## How the reporter skips quarantined tests

The skip happens in the reporter, not via a server:

1. **At test run start**, the reporter asks the server for the current quarantine list and writes it to a local file (default `./quarantine.json`).
2. **For each test**, the extended `test` fixture checks that file. If the test ID matches, it skips with the server's reason as the skip message.
3. **At the end**, results upload as normal.

To turn it on, use the extended `test` fixture and add the option:

```ts
// playwright.config.ts
import { test } from '@cyborgtests/reporter';

export default defineConfig({
  reporter: [
    ['blob', { outputFile: 'test-results/blob.zip' }],
    ['@cyborgtests/reporter', {
      url: 'https://reports.example.com',
      reportPath: 'test-results/blob.zip',
      resultDetails: { project: 'web' },
      skipQuarantinedTests: true,
      quarantineFilePath: './quarantine.json',  // optional
    }],
  ],
  test: test,   // the extended fixture
});
```

What you'll see in your CI logs: skipped tests with a reason like "Auto-quarantined due to 12% flakiness over threshold 5%" or whatever you have when you quarantined manually.

Things to be aware of:

- **Decision is per-run.** A test quarantined while a run is already in progress won't be skipped mid-run.
- **Fails open.** If the reporter can't reach the server at the start of the run (network down, auth wrong, server on fire), it logs a warning and runs everything.
- **Match your `project` name.** The `project` in `resultDetails` must match what you set up in the server.

Full reporter docs: [`packages/reporter/README.md`](https://github.com/CyborgTests/playwright-reports-server/blob/main/packages/reporter/README.md).

## The "Tests not running" sort

On the Tests page, the **Tests not running** sort surfaces tests that haven't executed recently. Useful for finding:

- Tests deleted from the suite but still on record (rename, refactor, lost in a merge conflict).
- Tests gated by env vars that nobody sets anymore.
- Tests in a project that quietly stopped running in CI.

These won't be auto-quarantined (no runs means no instability events, so no score) but they clutter the dashboard. Delete the dead ones periodically. Funeral ceremonies are entirely optional.

## See also

- [Regression tracking](./Regression-Tracking): the other lens on a failing test - was it green before, and is the break still open?
- [Analytics dashboard](./Analytics-Dashboard): where the tiers, quarantine status, and "Tests not running" sort live in the UI
- [Reporter docs](https://github.com/CyborgTests/playwright-reports-server/blob/main/packages/reporter/README.md): the `checkQuarantine` fixture in detail
