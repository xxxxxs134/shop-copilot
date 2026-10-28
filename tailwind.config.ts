import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
        },
        ink: { DEFAULT: '#0f172a', muted: '#475569', subtle: '#94a3b8' },
        surface: { DEFAULT: '#ffffff', muted: '#f8fafc', subtle: '#f1f5f9' },
        line: { DEFAULT: '#e2e8f0', strong: '#cbd5e1' },
        success: '#059669',
        warning: '#d97706',
        danger: '#dc2626',
        info: '#0284c7',
      },
      borderRadius: {
        card: '0.75rem',
        control: '0.5rem',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
      },
    },
  },
  plugins: [],
};

export default config;
