# UI white-label

Make the self-hosted instance look like your team's tool, not someone else's. Configured from `Settings -> Server Configuration` in the UI, or by `PATCH /api/config` if you'd rather script it.

## What you can change

| Field | Type | Default |
|-------|------|---------|
| Title | text | `Playwright Reports Server` |
| Logo | file upload or path | `/logo.svg` |
| Favicon | file upload or path | `/favicon.ico` |
| Invert logo in dark mode | boolean | `true` |
| Header links | array of `{ id, label, url, icon?, showLabel? }` | `[]` |

Clearing a field (empty title, removed logo) restores the default. The navbar always shows *something*. There are Reset buttons next to logo and favicon for when you want out of a branding misadventure.

## Fantastic files and where to find them

Your branding goes in `data/config.json` on the filesystem backend, or in the metadata DB on S3 / Azure backends. It follows your backup strategy. If you don't have one, it follows whatever happens when the storage is off.

## See also

- [Storage](./Storage): where branding files live per backend
