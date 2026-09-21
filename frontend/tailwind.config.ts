import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#172B4D',
        muted: '#626F86',
        line: '#DFE1E6',
        surface: '#FFFFFF',
        canvas: '#F7F8F9',
        brand: {
          DEFAULT: '#0C66E4',
          hover: '#0055CC',
          soft: '#E9F2FF',
        },
        success: '#22A06B',
        warning: '#E56910',
        danger: '#C9372C',
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
