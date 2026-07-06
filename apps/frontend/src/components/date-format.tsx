import { memo } from 'react';
import { type DateDisplayMode, formatDate, formatDateTooltip } from '@/lib/date';

interface FormattedDateProps {
  date: Date | string | number;
  mode?: DateDisplayMode;
  showTimezone?: boolean;
}

function FormattedDateImpl({
  date,
  mode = 'datetime',
  showTimezone = false,
}: Readonly<FormattedDateProps>) {
  return <span title={formatDateTooltip(date)}>{formatDate(date, mode, { showTimezone })}</span>;
}

const FormattedDate = memo(FormattedDateImpl);
export default FormattedDate;
