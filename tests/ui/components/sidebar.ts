import { BaseComponent } from './base.component';

export class SideBar extends BaseComponent {
  private results = this.page.getByTitle('Results');

  async openResult() {
    await this.results.click();
  }
}
