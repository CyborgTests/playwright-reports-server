import { BaseController } from './base.controller';
import { ReportController } from './report.controller';
import { ResultController } from './result.controller';

export class API extends BaseController {
  public result = new ResultController(this.request);
  public report = new ReportController(this.request);
}
