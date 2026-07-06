# Regression tracking

A flake fails and passes without anything changing. A regression is a test that was green,
broke, and stayed broken. Lumping the two together buries real breakages under noise, so
the server tracks regressions separately - opened when a test regresses, closed when it
recovers.

## What counts as a regression

On each report ingest the server compares a test's current outcome against its history.

- A test with a known last-green run that is now failing opens a regression. The event
  records the report it broke in (number and id), the commit at that point, the failure
  category, and the matching last-green report and commit.
- While it's open the regression accrues context: days open, how many times it has failed,
  and how many of those were flaky (failed then passed) rather than hard failures.
- When the test goes green again the regression is resolved, closed against the report that
  recovered it.

Since an open regression carries both the breaking commit and the last-green commit, it
brackets where the break landed - the range a bisect or a diff would look at.

## Where it shows up

- Report detail - a header chip flags regressions opened or resolved in that report.
- Test detail - an open regression shows the break point, the last-green baseline, and how long it's been open.
- Failure clusters - resolving a regression can resolve the underlying cluster and vice-versa, so a fix clears both.
- Analytics - regression signals sit next to flakiness, so a genuine break reads differently from a noisy test.
- Notifications - report and summary payloads carry regression signals, so a Slack or webhook alert can call out a new break instead of another flake.

## Regression, flakiness, quarantine

Three different questions about the same tests, easy to conflate:

| Signal | Question | Lives in |
|--------|----------|----------|
| Regression | Did something that worked break, and is it still broken? | this page |
| Flakiness | Is this test unreliable (fails and passes without changes)? | [Test management](./Test-Management) |
| Quarantine | Should we stop letting this noisy test fail the suite? | [Test management](./Test-Management) |

A test can be flaky and regressed at once; the flaky-failure count on an open regression is
where the two overlap.
