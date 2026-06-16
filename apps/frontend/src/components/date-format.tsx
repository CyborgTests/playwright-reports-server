import { memo, useMemo } from 'react';

function FormattedDateImpl({ date }: Readonly<{ date: Date | string }>) {
  const formatted = useMemo(() => new Date(date).toLocaleString(), [date]);
  return <span>{formatted}</span>;
}

const FormattedDate = memo(FormattedDateImpl);
export default FormattedDate;
