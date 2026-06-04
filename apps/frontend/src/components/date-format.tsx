'use client';
import { memo, useEffect, useState } from 'react';

/**
 * Specific method for date formatting on the client
 * as server locale and client locale may not match
 */
function FormattedDateImpl({ date }: Readonly<{ date: Date | string }>) {
  const [formattedDate, setFormattedDate] = useState('');

  useEffect(() => {
    setFormattedDate(new Date(date).toLocaleString());
  }, [date]);

  return <span>{formattedDate}</span>;
}

const FormattedDate = memo(FormattedDateImpl);
export default FormattedDate;
