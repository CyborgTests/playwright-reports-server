import { ReportController } from './report.controller';
import { ResultController } from './result.controller';
import { BaseController } from './base.controller';

export class API extends BaseController {
  public result = new ResultController(this.request);
  public report = new ReportController(this.request);
}
