import { Page as page } from '@playwright/test';
import { BasePage } from './base.page';
import { ResultPage } from './results';
import { ReportsPage } from './reports';

export class Application extends BasePage {
  public result: ResultPage;
  public reports: ReportsPage;

  constructor(page: page) {
    super(page);
    this.result = new ResultPage(this.page);
    this.reports = new ReportsPage(this.page);
  }
}
