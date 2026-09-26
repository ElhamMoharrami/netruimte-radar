/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      colors: {
        radar: {
          bg: '#0b1220',
          panel: '#111a2e',
          accent: '#22d3ee',
          muted: '#64748b',
        },
      },
    },
  },
  plugins: [],
};
