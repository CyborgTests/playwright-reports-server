import { defineConfig } from 'vitepress'

// Site is published under https://<user>.github.io/playwright-reports-server/
// so base must match the repo name. Override with DOCS_BASE for a custom domain.
const base = process.env.DOCS_BASE ?? '/playwright-reports-server/'

export default defineConfig({
  base,
  lang: 'en-US',
  title: 'Playwright Reports Server',
  description: 'Store, merge, serve, and analyze Playwright reports.',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['README.md'],
  ignoreDeadLinks: true,
  themeConfig: {
    search: { provider: 'local' },
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Configuration', link: '/Configuration' },
    ],
    sidebar: [
      {
        text: 'Ops & infrastructure',
        items: [
          { text: 'Configuration', link: '/Configuration' },
          { text: 'Authentication', link: '/Authentication' },
          { text: 'Storage', link: '/Storage' },
          { text: 'Deployment', link: '/Deployment' },
          { text: 'Notifications', link: '/Notifications' },
          { text: 'UI white-label', link: '/White-label' },
        ],
      },
      {
        text: 'Getting reports in',
        items: [
          { text: 'Uploading reports', link: '/Uploading-Reports' },
          { text: 'Data migration', link: '/Data-Migration' },
          { text: 'GitHub Sync', link: '/GitHub-Sync' },
        ],
      },
      {
        text: 'Day-to-day features',
        items: [
          { text: 'Overview dashboard', link: '/Overview-Dashboard' },
          { text: 'Analytics dashboard', link: '/Analytics-Dashboard' },
          { text: 'Regression tracking', link: '/Regression-Tracking' },
          { text: 'Test management & quarantine', link: '/Test-Management' },
          { text: 'Report export (PDF)', link: '/Report-Export' },
        ],
      },
      {
        text: 'LLM integration',
        items: [
          { text: 'Analysis', link: '/LLM-Analysis' },
          { text: 'Routing', link: '/LLM-Routing' },
          { text: 'Selection', link: '/LLM-Selection' },
          { text: 'Code assistant', link: '/Code-Assistant' },
        ],
      },
    ],
    editLink: {
      pattern:
        'https://github.com/CyborgTests/playwright-reports-server/edit/main/website/:path',
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/CyborgTests/playwright-reports-server' },
    ],
  },
})
