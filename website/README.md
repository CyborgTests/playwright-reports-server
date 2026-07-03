# Docs site (`@playwright-reports/docs`)

VitePress site published to GitHub Pages.

## Develop

From the repo root:

```bash
pnpm docs:dev        # install + hot-reload dev server (http://localhost:5173)
pnpm docs:build      # production build to .vitepress/dist
pnpm docs:preview    # serve the built site locally
```

Or from this folder: `pnpm install` then `pnpm dev` / `pnpm build` / `pnpm preview`.

## Add / edit a page

1. Drop a `.md` file in this folder (Markdown + [Vue in Markdown](https://vitepress.dev/guide/using-vue) supported).
2. Add it to the sidebar in `.vitepress/config.mts`.

Literal `{{ }}` is auto-escaped; a bare triple-stache `{{{ }}}` must be
wrapped as `<code v-pre>{{{ }}}</code>` (VitePress reads `{{` as a Vue interpolation).

## Deploy

Push to `main` that touches `website/**` trigger `.github/workflows/docs.yml`, which
builds and deploys to GitHub Pages.

`base` is `/playwright-reports-server/` (project Pages URL). For a custom domain, set
`DOCS_BASE=/` in the workflow build step.
