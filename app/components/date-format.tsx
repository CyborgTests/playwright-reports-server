'use client';
import { useState, useEffect } from 'react';

/**
 * Specific method for date formatting on the client
 * as server locale and client locale may not match
 */
export default function FormattedDate({ date }: { date: Date }) {
  const [formattedDate, setFormattedDate] = useState('');

  useEffect(() => {
    setFormattedDate(new Date(date).toLocaleString());
  }, [date]);

  return <span>{formattedDate}</span>;
}
