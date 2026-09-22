import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Atlassian dark tokens. `surface` sits above `canvas` so cards lift off
      // the background without a shadow, and `ink` is deliberately off-white —
      // pure white on a dark canvas glares over a long report session.
      colors: {
        ink: '#B6C2CF',
        muted: '#8C9BAB',
        line: '#2C333A',
        surface: '#1D2125',
        canvas: '#161A1D',
        /** Raised inputs and hovers, one step lighter than `surface`. */
        raised: '#22272B',
        brand: {
          DEFAULT: '#579DFF',
          hover: '#85B8FF',
          soft: '#1C2B41',
          /** Readable text/icon color on a filled `brand` button. */
          contrast: '#1D2125',
        },
        success: '#7EE2B8',
        warning: '#F5CD47',
        danger: '#FF9C8F',
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
