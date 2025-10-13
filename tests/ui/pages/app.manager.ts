import { Page as page } from '@playwright/test';
import { BasePage } from './base.page.js';
import { ResultPage } from './result.js';
import { ReportPage } from './report.js';

export class Application extends BasePage {
  public result: ResultPage;
  public report: ReportPage;

  constructor(page: page) {
    super(page);
    this.result = new ResultPage(this.page);
    this.report = new ReportPage(this.page);
  }
}
