import { BasePage } from './base.page';
import { DataTable } from '../components/data.table.component';
import { UploadResultPopup } from '../components/upload.result.component';

export class ResultPage extends BasePage {
  private title = this.page.getByRole('heading', { name: 'Results' });
  private generateReportButton = this.page.getByRole('button', { name: 'Generate Report' });
  private uploadResultbutton = this.page.getByRole('button', { name: 'Upload Results' });
  private deleteButton = this.page.getByRole('button', { name: 'Delete', exact: false });
  private search = this.page.getByLabel('Search...');
  private dataTable = new DataTable(this.page);
  private uploadPopup = new UploadResultPopup(this.page);
  private successPopup = this.page.getByText('Results uploaded successfully');

  async navigateTo() {
    await this.page.goto('/results');
  }
  async verifyPageElementsVisible() {
    await this.title.isVisible();
    await this.generateReportButton.isVisible();
    await this.uploadResultbutton.isVisible();
    await this.deleteButton.isVisible();
    await this.search.isVisible();
  }
  async uploadResult() {
    await this.uploadResultbutton.click();
    await this.uploadPopup.uploadResult();
    await this.successPopup.isVisible();
  }
  async verifyResultData(project: string, tag: string) {
    await this.dataTable.verifyColumnData(project, tag);
  }
}
