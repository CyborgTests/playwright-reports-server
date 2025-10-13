import { BasePage } from './base.page';
import { ResultTable } from '../components/result.table.component';
import { UploadResultPopup } from '../components/upload.result.component';
import { GenerateReportPopup } from '../components/generate.report.component';
import { NavBar } from '../components/nav.bar.component';

export class ResultPage extends BasePage {
  private title = this.page.getByRole('heading', { name: 'Results' });
  private generateReportButton = this.page.getByRole('button', { name: 'Generate Report' });
  private uploadResultbutton = this.page.getByRole('button', { name: 'Upload Results' });
  private deleteButton = this.page.getByRole('button', { name: 'Delete', exact: false });
  private search = this.page.getByLabel('Search...');
  private dataTable = new ResultTable(this.page);
  private uploadPopup = new UploadResultPopup(this.page);
  private generatePopup = new GenerateReportPopup(this.page);
  private navbar = new NavBar(this.page);
  private successUploadPopup = this.page.getByText('Results uploaded successfully');
  private successGeneratePopup = this.page.getByText(/^report [0-9a-f-]{36} is generated\.$/i);

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
    await this.successUploadPopup.isVisible();
  }
  async verifyResultData(project: string, tag: string) {
    await this.dataTable.verifyResultColumnData(project, tag);
  }
  async selectResult() {
    await this.dataTable.selectResult();
  }
  async verifySelectionCount() {
    await this.dataTable.verifySelectionCount();
  }

  async generateReport(project: string, reportname: string) {
    await this.generateReportButton.click();
    await this.generatePopup.generateReport(project, reportname);
    await this.successGeneratePopup.isVisible();
  }
  async openReportPage() {
    await this.navbar.openReportPage();
  }
}
