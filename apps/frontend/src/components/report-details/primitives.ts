export const title = () => 'text-2xl font-bold text-gray-900';

export const text = (variant: 'sm' | 'base' | 'lg' = 'base') => {
  const baseClasses = 'text-gray-600';
  switch (variant) {
    case 'sm':
      return `${baseClasses} text-sm`;
    case 'lg':
      return `${baseClasses} text-lg`;
    default:
      return baseClasses;
  }
};

export const badge = (variant: 'success' | 'error' | 'warning' | 'default' = 'default') => {
  const baseClasses = 'px-2 py-1 rounded text-xs font-medium';
  switch (variant) {
    case 'success':
      return `${baseClasses} bg-success-100 text-success-900`;
    case 'error':
      return `${baseClasses} bg-danger-100 text-danger-900`;
    case 'warning':
      return `${baseClasses} bg-warning-100 text-warning-900`;
    default:
      return `${baseClasses} bg-muted text-muted-foreground`;
  }
};

export const subtitle = () => 'text-sm text-gray-500 font-medium';
