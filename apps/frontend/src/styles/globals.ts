export const fontSans = 'Inter, system-ui, sans-serif';

export const focusStyles = {
  outline: '2px solid #3b82f6',
  outlineOffset: '2px',
};

export const scrollbarStyles = {
  '&::-webkit-scrollbar': {
    width: '6px',
    height: '6px',
  },
  '&::-webkit-scrollbar-track': {
    background: '#f1f5f9',
  },
  '&::-webkit-scrollbar-thumb': {
    background: '#94a3b8',
    borderRadius: '3px',
  },
  '&::-webkit-scrollbar-thumb:hover': {
    background: '#64748b',
  },
};

export const testStatusToColor = (status: string) => {
  switch (status) {
    case 'passed':
      return { colorName: 'success', title: 'Passed', color: 'text-success' };
    case 'failed':
      return { colorName: 'danger', title: 'Failed', color: 'text-danger' };
    case 'skipped':
      return {
        colorName: 'warning',
        title: 'Skipped',
        color: 'text-warning',
      };
    case 'flaky':
      return { colorName: 'default', title: 'Flaky', color: 'text-muted-foreground' };
    default:
      return { colorName: 'default', title: 'Unknown', color: 'text-muted-foreground' };
  }
};

export const cn = (...inputs: (string | undefined | null | false)[]) => {
  return inputs.filter(Boolean).join(' ');
};
