# Report export (PDF)

Turn a served report into a single PDF - for an audit trail, a review attachment, or
someone who wants the report but will never log in.

The **Download PDF** button sits in the report detail page header. The PDF is built
server-side with `pdf-lib` - no headless browser, no Playwright HTML round-trip - so it
behaves the same in a slim container as it does locally.

## What goes in

The button sends `scope=all` with the previous report as the baseline. To script it, hit
the endpoint directly with query parameters:

`GET /api/report/:id/export.pdf`

| Parameter | Values | Default | Effect |
|-----------|--------|---------|--------|
| `scope` | `all` / `failures` | `all` | Every test, or only the failures. |
| `compare` | a report id, or `previous` | *(none)* | Include a diff against a baseline report. `previous` picks the prior report automatically. |
| `screenshots` | `1` / `0` | `1` | Embed failure screenshots. |
| `analysis` | `1` / `0` | `1` | Include the LLM failure analysis text. |
| `onePerPage` | `1` / `0` | `1` | One test per page, or pack them. |

The file is named `{project}-{report-number}-{timestamp}.pdf`.

## Notes

- **Failures-only, no screenshots, packed** (`scope=failures&screenshots=0&onePerPage=0`)
  gives the smallest, quickest-to-skim artifact.
- Text is sanitised to what the PDF fonts can draw, so odd Unicode in test titles or
  analysis won't crash the export - it's transliterated or dropped.
- When auth is on, the export endpoint is guarded like the rest of the API - a caller
  needs report-read access (a session or an API key), same as fetching the report itself.
