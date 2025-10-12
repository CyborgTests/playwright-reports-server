import { BaseComponent } from './base.component.js';
import path from 'node:path';

export class UploadResultPopup extends BaseComponent {
  private title = this.page.getByRole('heading', { name: 'Upload Results' });
  private uploadFileButton = this.page.getByLabel('Result File');
  private projectField = this.page.getByRole('combobox', { name: 'Project (optional)' });
  private tagsField = this.page.getByRole('textbox', { name: "Enter tag (e.g., 'key:value'" });
  private addButton = this.page.getByRole('button', { name: 'Add' });
  private uploadButton = this.page.getByRole('button', { name: 'Upload' });

  async uploadResult() {
    await this.title.isVisible();
    await this.uploadButton.isDisabled();
    await this.uploadFileButton.isVisible();
    const filePath = path.resolve(process.cwd(), 'tests/testdata/blob.zip');
    await this.uploadFileButton.setInputFiles(filePath);
    await this.projectField.isVisible();
    await this.projectField.fill('UI');
    await this.page.keyboard.press('Enter');
    await this.tagsField.isVisible();
    await this.tagsField.fill('tag:e2e');
    await this.addButton.click();
    await this.uploadButton.isEnabled();
    await this.uploadButton.click();
  }
}
