'use client';

import { useTheme } from 'next-themes';
import { type FC, useEffect, useState } from 'react';
import { MoonFilledIcon, SunFilledIcon } from './icons';

interface ThemeSwitchProps {
  className?: string;
}

export const ThemeSwitch: FC<ThemeSwitchProps> = ({ className }) => {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // normalize theme name for compatibility with theme picker from playwright trace view
  const currentTheme = theme?.replace('-mode', '') ?? 'dark';

  const onChange = () => {
    currentTheme === 'light' ? setTheme('dark-mode') : setTheme('light-mode');
  };

  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-lg p-2 hover:bg-accent transition-colors ${className || ''}`}
      onClick={onChange}
      aria-label={`Switch to ${currentTheme === 'light' ? 'dark' : 'light'} mode`}
    >
      {mounted ? (
        currentTheme === 'light' ? (
          <MoonFilledIcon size={20} />
        ) : (
          <SunFilledIcon size={20} />
        )
      ) : (
        <span style={{ width: 20, height: 20, display: 'inline-block' }} />
      )}
    </button>
  );
};
