'use client';
import { useState, useEffect } from 'react';

/**
 * Specific method for date formatting on the client
 * as server locale and client locale may not match
 */
export default function FormattedDate({ date }: { date: Date }) {
  const [formattedDate, setFormattedDate] = useState('');

  useEffect(() => {
    // Follow the browser's preferred language (navigator.language) rather than the
    // runtime default, which uses Chrome's UI/display language and falls back to
    // en-US (American MM/DD/YYYY) regardless of the user's preferred-languages list.
    setFormattedDate(new Date(date).toLocaleString(navigator.language));
  }, [date]);

  return <span>{formattedDate}</span>;
}
