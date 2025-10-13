import { BaseComponent } from './base.component.js';
import { expect } from '@playwright/test';

export class ReportTable extends BaseComponent {
  private titleCell = this.page.locator('tbody tr').getByRole('link').first();
  private projectCell = this.page.getByRole('gridcell').nth(0);
  private createdAtCell = this.page.getByRole('gridcell').nth(1);
  private sizeCell = this.page.getByRole('gridcell').nth(2);
  private deleteButton = this.page.getByRole('button', { name: 'Delete results' }).nth(3);
  private openReportButton = this.page.getByRole('button', { name: 'Open report' }).nth(4);

  async verifyReportColumnData(title: string, project: string) {
    await this.titleCell.isVisible({ timeout: 20_000 });
    await expect(this.titleCell).toHaveText(title);
    await expect(this.projectCell).toHaveText(project);
    await this.createdAtCell.isVisible();
    await this.sizeCell.isVisible();
    await this.openReportButton.isVisible();
    await this.deleteButton.isVisible();
  }

  async verifyOpenReportByLink() {
    await this.titleCell.click();
  }
  async verifyOpenPlaywrightReport() {
    await this.titleCell.isVisible({ timeout: 15_000 });
    await this.openReportButton.click();
  }
}
