import { Page as page } from '@playwright/test';
import { BasePage } from './base.page';
import { ResultPage } from './results';

export class Application extends BasePage {
  public result: ResultPage;

  constructor(page: page) {
    super(page);
    this.result = new ResultPage(this.page);
  }
}
