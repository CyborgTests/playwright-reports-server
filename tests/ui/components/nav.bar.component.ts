import { BaseComponent } from './base.component.js';

export class NavBar extends BaseComponent {
  private reports = this.page.getByTitle('Reports');

  async openReportPage() {
    await this.reports.click();
  }
}
