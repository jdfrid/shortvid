/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif']
      },
      colors: {
        gold: {
          50: '#fdfaf3',
          100: '#f9f0d9',
          200: '#f2ddb3',
          300: '#e9c582',
          400: '#dfa94f',
          500: '#d4912e',
          600: '#c27523',
          700: '#a1591f',
          800: '#834720',
          900: '#6b3c1e'
        },
        midnight: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d5dae3',
          300: '#b0b9ca',
          400: '#8594ac',
          500: '#667792',
          600: '#516079',
          700: '#434e62',
          800: '#3a4353',
          900: '#1a1f2e',
          950: '#0f1219'
        }
      }
    }
  },
  plugins: []
};
