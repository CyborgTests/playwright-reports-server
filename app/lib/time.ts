export const parseMilliseconds = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  const leftMs = ms % 1000;
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s ${leftMs}ms`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s ${leftMs}ms`;
  }

  if (seconds > 0) {
    return `${seconds}s ${leftMs}ms`;
  }

  return `${leftMs}ms`;
};

export const getTimestamp = (date?: Date | string) => {
  if (!date) return 0;
  if (typeof date === 'string') return new Date(date).getTime();

  return date.getTime();
};
