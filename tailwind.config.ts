import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './src/components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cherry: { DEFAULT: '#990011', dark: '#6B000C' },
        navy: { DEFAULT: '#1E2761', light: '#2E3A73' },
      },
      fontFamily: {
        sans: ['Tahoma', 'Segoe UI', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
