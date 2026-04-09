import { BasePage } from './base.page';
import path from 'node:path';
import { SideBar } from '../components/sidebar';

export class ResultPage extends BasePage {
  private sidebar = new SideBar(this.page);
  private header = this.page.getByTitle('Results');
  private uploadResButton = this.page.getByRole('button', { name: 'Upload Results' });
  private uploadPopup = this.page.getByRole('dialog');
  private title = this.page.getByTitle('Upload Results');
  private fileInput = this.page.getByLabel('Result File');
  private project = this.page.getByRole('combobox', { name: 'Project (optional)' });
  private tag = this.page.getByRole('textbox', { name: "Enter tag (e.g., 'key:value'" });
  private addButton = this.page.getByRole('button', { name: 'Add' });
  private uploadButton = this.page.getByRole('button', { name: 'Upload' });
  private successMessage = this.page.getByText('Results uploaded successfully');

  async navigateTo() {
    await this.page.goto('');
  }

  async openResult() {
    await this.sidebar.openResult();
  }

  async verifyPageElements() {
    await this.header.isVisible();
  }

  async uploadResult() {
    await this.uploadResButton.click();
    await this.uploadPopup.isVisible();
    await this.title.isVisible();
    const filePath = path.resolve(process.cwd(), 'tests/testdata/correct_blob.zip');
    await this.fileInput.setInputFiles(filePath);
    await this.project.fill('e2e');
    await this.page.keyboard.press('Enter');
    await this.tag.fill('project:e2e');
    await this.addButton.click();
    await this.uploadButton.click();
    await this.successMessage.isVisible();
  }
}
