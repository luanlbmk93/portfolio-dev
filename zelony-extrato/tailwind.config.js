/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        zelony: {
          bg: '#0f0f0f',
          surface: '#1a1a1a',
          card: '#222222',
          border: '#3a3a3a',
          gold: '#c9a44a',
          'gold-hover': '#ddb85a',
          brown: '#6b4e23',
          muted: '#a3a3a3',
        },
      },
      boxShadow: {
        gold: '0 4px 24px rgba(201, 164, 74, 0.15)',
      },
    },
  },
  plugins: [],
};
