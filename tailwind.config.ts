import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './src/components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cherry: { DEFAULT: '#990011', dark: '#6B000C', light: '#C4132A' },
        navy: { DEFAULT: '#1E2761', light: '#2E3A73', dark: '#141A45' },
        gold: { DEFAULT: '#C9A227', light: '#E4C558' },
      },
      fontFamily: {
        sans: ['Tajawal', 'Tahoma', 'Segoe UI', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 8px 30px -8px rgba(153, 0, 17, 0.35)',
        'navy-glow': '0 8px 30px -8px rgba(30, 39, 97, 0.35)',
      },
      keyframes: {
        'fade-in-up': { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'pulse-soft': { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.55' } },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.4s ease-out both',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
