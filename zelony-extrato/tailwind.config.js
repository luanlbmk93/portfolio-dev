/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        zelony: {
          bg: '#09090b',
          'bg-elevated': '#0f0f12',
          surface: '#141418',
          card: '#1a1a1f',
          'card-hover': '#222228',
          border: '#2a2a32',
          'border-subtle': '#1f1f24',
          gold: '#d4af37',
          'gold-soft': '#c9a44a',
          'gold-hover': '#e4c04a',
          'gold-dim': '#7a6230',
          brown: '#4a3822',
          muted: '#71717a',
          text: '#fafafa',
          'text-secondary': '#a1a1aa',
        },
      },
      backgroundImage: {
        'zelony-mesh':
          'radial-gradient(ellipse 90% 60% at 50% -30%, rgba(212, 175, 55, 0.14), transparent 55%), radial-gradient(ellipse 50% 40% at 100% 0%, rgba(74, 56, 34, 0.2), transparent), radial-gradient(ellipse 40% 30% at 0% 100%, rgba(212, 175, 55, 0.06), transparent)',
      },
      boxShadow: {
        card: '0 1px 0 rgba(255,255,255,0.05) inset, 0 8px 32px rgba(0,0,0,0.45)',
        'card-hover': '0 1px 0 rgba(255,255,255,0.06) inset, 0 12px 40px rgba(0,0,0,0.5)',
        gold: '0 4px 24px rgba(212, 175, 55, 0.2)',
        'gold-sm': '0 2px 12px rgba(212, 175, 55, 0.15)',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.45s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
