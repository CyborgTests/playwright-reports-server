import { BasePage } from './base.page';
import { SideBar } from '../components/sidebar';

export class ReportsPage extends BasePage {
  private sidebar = new SideBar(this.page);

  async navigateTo() {
    await this.page.goto('/reports');
  }

  async setDateFrom(date: string) {
    // The date inputs are the 2nd and 3rd text inputs on the page (0=search, 1=from, 2=to)
    const inputs = this.page.locator('input[type="text"]');
    await inputs.nth(1).fill(date);
    await inputs.nth(1).dispatchEvent('change');
  }

  async setDateTo(date: string) {
    const inputs = this.page.locator('input[type="text"]');
    await inputs.nth(2).fill(date);
    await inputs.nth(2).dispatchEvent('change');
  }

  async getReportRows() {
    return this.page.getByRole('row').filter({ has: this.page.locator('a[href*="/report/"]') });
  }

  async getDownloadButtonsForFirstRow() {
    const firstRow = this.page.getByRole('row').nth(1); // Skip header row
    return firstRow.getByLabel(/Download/);
  }

  async isDownloadButtonVisible() {
    const buttons = this.getDownloadButtonsForFirstRow();
    return buttons.count().then((count) => count > 0);
  }

  async countVisibleReports() {
    return this.page.getByRole('row', { exact: true }).count();
  }
}

