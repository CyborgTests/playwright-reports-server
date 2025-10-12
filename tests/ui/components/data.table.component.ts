import { BaseComponent } from './base.component.js';
import { expect } from '@playwright/test';

export class DataTable extends BaseComponent {
  private titleCell = this.page.getByRole('rowheader').nth(0);
  private projectCell = this.page.getByRole('gridcell').nth(1);
  private createdAtCell = this.page.getByRole('gridcell').nth(2);
  private tagCell = this.page.getByRole('gridcell').nth(3);
  private sizeCell = this.page.getByRole('gridcell').nth(4);
  private deleteButton = this.page.getByRole('button', { name: 'Delete results' }).nth(5);

  async verifyColumnData(project: string, tag: string) {
    await this.titleCell.isVisible();
    await expect(this.projectCell).toHaveText(project);
    await this.createdAtCell.isVisible();
    await expect(this.tagCell).toHaveText(tag);
    await this.sizeCell.isVisible();
    await this.deleteButton.isVisible();
  }
}
