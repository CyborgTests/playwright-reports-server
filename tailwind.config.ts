import type { Config } from 'tailwindcss';

import { nextui } from '@nextui-org/theme';

const config = {
  content: ['./app/**/*.{js,ts,tsx,mdx}', './node_modules/@nextui-org/theme/dist/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
    },
  },
  darkMode: 'class',
  plugins: [nextui()],
} satisfies Config;

export default config;
