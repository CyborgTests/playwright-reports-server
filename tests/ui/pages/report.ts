import { BasePage } from './base.page';
import { ReportTable } from '../components/report.table.component';
import { expect } from '@playwright/test';

export class ReportPage extends BasePage {
  private reportData = new ReportTable(this.page);
  private reportName = this.page.getByRole('heading').first();

  async verifyReportData(title: string, project: string) {
    await this.reportData.verifyReportColumnData(title, project);
  }
  async verifyOpenReportByLink() {
    await this.reportData.verifyOpenReportByLink();
    await expect(this.page).toHaveURL(/\/reports/);
  }
  async verifyOpenPlaywrightReport() {
    await this.reportData.verifyOpenPlaywrightReport();
    const [newPage] = await Promise.all([this.page.waitForEvent('popup')]);
    await newPage.waitForLoadState('domcontentloaded');
    await expect(newPage).toHaveURL(/\/index.html/);
  }
}
