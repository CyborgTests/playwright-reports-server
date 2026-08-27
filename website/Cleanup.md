# Cleanup

Reports pile up. Cleanup is the Settings -> **Cleanup** section where you set per-artifact retention so old stuff deletes itself instead of slowly eating the space. Nothing is deleted until you explicitly confirm a rule, and everything is off by default.

## The rules

| Rule | Deletes |
|------|---------|
| **Traces** | Trace archives, DOM snapshots, and the trace viewer app folder |
| **Videos** | Failure videos |
| **Screenshots** | Failure screenshots |
| **Report folder** | The entire report folder on disk |
| **Report + history** | The report itself plus database records: test runs, LLM analyses  |
| **Results** | Raw result blobs |

### Nesting constraint

An artifact can't outlive its container. If the report folder is set to 30 days, traces can't be kept for 90 - when the folder is deleted, the traces are deleted as well.

## Confirmation

Before starting or rescheduling the cleanup job it will ask for confirmation to avoid accidental data deletion.

## Estimates

Each row shows a live estimate of what the rule would delete today, recalculated as you edit the draft: total size, file count, affected reports - plus test runs and LLM analyses for the report-record rule. If you do not see the estimate - there is a background job that will estimate the current state of the storage and will be available the next day:

- **"+N not yet measured"**: file counts and sizes come from a per-report measurement recorded by the [storage-reconcile job](./Storage#what-lives-where) (runs daily, measures up to 5,000 reports per single run). Reports that haven't been measured yet count toward the row total but contribute zero files. Give it some time to process your reports to get proper estimates.  
- **Open regressions are never counted**: any report that's part of an unresolved regression (broken with no recovery since) is not included into any deletion rule.

---

## See also

- [Storage](./Storage) - where the deleted bytes used to live
- [Configuration](./Configuration) - `S3_BATCH_SIZE` / `AZURE_BATCH_SIZE`, which throttle cleanup requests against object storage
