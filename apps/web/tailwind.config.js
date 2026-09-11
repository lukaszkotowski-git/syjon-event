/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#d9e5ff',
          500: '#3b62f6',
          600: '#2b4ada',
          700: '#2239ab',
        },
      },
    },
  },
  plugins: [],
};
