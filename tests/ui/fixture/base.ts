import { test as base, expect } from '@playwright/test';
import { Application } from '../pages/app.manager';

export const test = base.extend<{
  app: Application;
}>({
  app: async ({ browser, page }, use) => {
    test.info().annotations.push({
      type: 'Browser',
      description: `${browser.browserType().name()} ${browser.version()}`,
    });

    const app = new Application(page);
    await use(app);
  },
});
