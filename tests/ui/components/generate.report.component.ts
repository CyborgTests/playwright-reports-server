import { BaseComponent } from './base.component.js';
import { expect } from '@playwright/test';

export class GenerateReportPopup extends BaseComponent {
  private title = this.page.getByRole('heading', { name: 'Generate report' });
  private projectField = this.page.getByRole('combobox', { name: 'Project name' });
  private reportName = this.page.getByRole('textbox', { name: 'Custom report name Custom' });
  private generateButton = this.page.getByRole('button', { name: 'Generate' });

  async generateReport(project: string, reportName: string) {
    await this.title.isVisible();
    await expect(this.projectField).toHaveValue(project);
    await this.reportName.fill(reportName);
    await this.generateButton.click();
  }
}
