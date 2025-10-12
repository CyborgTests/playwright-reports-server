import { Page as page } from '@playwright/test';

export class PageHolder {
  protected page: page;

  constructor(page: page) {
    this.page = page;
  }
}
