import type { Config } from 'tailwindcss';

// Tailwind 4 — most theming lives in `globals.css` via @theme + CSS variables.
// This file remains minimal but is kept for IDE intellisense and future plugins.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
