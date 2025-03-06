import type { Config } from 'tailwindcss';

import { heroui } from '@heroui/theme';

const config = {
  content: ['./app/**/*.{js,ts,tsx,mdx}', './node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
    },
  },
  darkMode: 'class',
  plugins: [heroui()],
} satisfies Config;

export default config;
