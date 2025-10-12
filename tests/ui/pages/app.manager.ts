import { Page as page } from '@playwright/test';
import { BasePage } from './base.page.js';
import { ResultPage } from './result.js';

export class Application extends BasePage {
  public result: ResultPage;

  constructor(page: page) {
    super(page);
    this.result = new ResultPage(this.page);
  }
}
