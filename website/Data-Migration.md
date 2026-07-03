# Data migration

Coming from an older Playwright Reports Server instance? A one-time importer registers the
reports and results already sitting in your storage backend, so a fresh instance picks up
the whole back-catalogue without re-uploading anything.

## What it does

- Scans the configured storage layout (`fs` / `s3` / `azure`) for the original server's
  `{project}/{id}` structure and registers the reports and results it finds.
- Serves those reports in place from their original location. It doesn't move, copy, or
  re-pack anything, so nothing is duplicated.
- Backfills the database (run history, stats) so analytics and flakiness treat the imported
  reports the same as freshly uploaded ones.

## How to run it

The Data Migration panel shows up on the init page - the landing screen of a fresh
instance - as an "Import legacy data?" action. It only appears while the reports table is
empty, so it's a bootstrap step rather than an ongoing sync; once you have reports the
option is gone. The import runs on the server, so you can leave the page and it keeps going;
the widget reports progress and completion.

> Point the new instance at the same storage (`DATA_STORAGE` plus the matching S3/Azure or
> `fs` volume) as the old one first - the importer reads whatever that backend contains. See
> [Storage](./Storage) and [Configuration](./Configuration).

## When to use something else

For ongoing ingestion from CI, use the [reporter or CLI upload](./Uploading-Reports). To
pull artifacts out of GitHub Actions on a schedule, that's [GitHub Sync](./GitHub-Sync).
This importer is only for the initial move of an old server's data.
