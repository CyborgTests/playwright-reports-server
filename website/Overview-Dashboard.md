# Overview dashboard

A configurable home page that answers one question at a glance: **are you winning son?**

Every Playwright project you care about gets a card with a letter grade (`S A B C D F`) and an `OK / NOT OK` verdict, rolled up to a single overall score per dashboard. Pin one or more dashboards to `/` and arrange them in the order you want to see them.

---

## When to use it

- **Morning glance.** Check the colors, move on.
- **On-call dashboard.** Configure a "smoke" dashboard with strict thresholds - a red border means something needs a human right now.
- **Release readiness gate.** Define a "Release" dashboard with the components that must be green.
- **Org-level rollup.** One dashboard per team, each team checks their slice, leadership can see them all stacked.

---

## How the signal is computed

The dashboard turns "latest Playwright report per project" into a grade in four steps.

### 1 - Pass rate per project

| Formula | Pass rate | Use when |
|---|---|---|
| **lenient** *(default)* | `(passed + flaky) / (passed + failed + flaky)` | Flakes are a temporary blip, not a real failure. |
| **strict** | `passed / (passed + failed + flaky)` | Flakes are unacceptable! |

### 2 - Grade

The pass rate maps to a letter via configurable **grade bands**.

### 3 - Verdict

Each node has a **min-OK grade**. Verdict is `OK` when the current grade is at least that high.

### 4 - Rollup

Groups and the dashboard root combine children using a **weighted average of pass rates**:

```
rolled-up pass rate  =  Σ (child.passRate × child.weight)  /  Σ child.weight
```

That rolled-up rate is graded with the group's own bands. A group is `OK` only when **every positive-weight component is OK** - one red component fails the widget, even if the average looks fine.

### Staleness

When a project's latest report is older than the dashboard's `stalenessDays` threshold, the project is **stale**. The grade is still computed from the (old) report.

## Configuring a dashboard as a high-level signal

The default dashboard is a starting point. To get a signal you actually trust, treat configuration as encoding **what "healthy" means for your team**.

### Start from the signal

Before adding nodes, decide:

1. **What does "OK" mean here?** Is `B` (90%) acceptable, or does this need `S` (99%)?
2. **What's the audience?** Leadership ("is the org green") vs. on-call ("page me when red") vs. release manager ("can we ship") imply different thresholds.
3. **Lenient or strict?** If a flaky test means a real bug for this surface, pick `strict`.

### Build the tree to model real importance

- **Group by ownership** "Payments team" / "Mobile team" is more useful for accountability than "Chromium / Firefox / WebKit." or "Staging Env" / "QA Env".
- **Use weights to encode "does this matter much."** A login-flow project at `weight = 5` correctly dominates five `weight = 1` micro-projects in the rollup. A nice-to-have project at `weight = 0` is visible in the tree but doesn't move the parent grade.

### Tune staleness per dashboard

`stalenessDays` is a single number per dashboard, pick the cadence your team actually ships at:

- Daily CI runs -> `stalenessDays = 2` (a weekend off is OK, a Monday with no Sunday run is not).
- Nightly only -> `stalenessDays = 3`.
- Release-gate dashboards -> `stalenessDays = 14` (long-lived branches, can be a gap between cuts).

### Patterns

| Pattern | Setup |
|---|---|
| **On-call "page me when red"** | One dashboard, projects = production surfaces, `formula = strict`, `minOkGrade = A`, `stalenessDays = 1`. Border goes red -> investigate. |
| **Release readiness** | One dashboard per release train. Projects = surfaces that must be green to cut. `minOkGrade = S`, `stalenessDays = 14`. Pin to home only during release week. |
| **Team-of-teams rollup** | One dashboard per team, all pinned to home. Each team owns their config; the home page is the org-wide stack. Order matters - most important team first. |
| **Critical-path subset** | A separate dashboard with `weight = 5` on must-pass projects, `weight = 1` on everything else. Same projects as another dashboard, different priorities - that's fine. |
| **Smoke vs. regression** | Two dashboards. "Smoke" uses `formula = strict`, `minOkGrade = A`. "Regression" uses `formula = lenient`, `minOkGrade = C`. Different definitions of healthy for different test tiers. |

---

## Operating the dashboards

### Create

Click **+ New** in the header. Name has to be unique (case-insensitive).

### Edit

Hover any card and click **Edit**. Two panels:

- **Top:** dashboard settings - name, staleness, defaults, pin toggle, delete.
- **Bottom-left:** the project/group tree with live grade previews. Siblings could be reordered with arrow icons. Add children inside any group.
- **Bottom-right:** node config form - name, project (project nodes only), weight, formula, min-OK grade, grade bands. A "Resolved" summary at the bottom shows the effective values after inheritance, so you can verify what will be persisted.

Click **Save dashboard** to commit. **The slug stays stable across renames** so shared `/?dashboard=<slug>` links keep working.

### Delete

Edit -> **Delete dashboard**. Cascades to all child nodes. Unpinned dashboards stay reachable via the selector dropdown.