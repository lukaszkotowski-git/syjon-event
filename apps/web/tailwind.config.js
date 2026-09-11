/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: {
        // Próg z briefu: duże tło wydarzenia od 800px, małe poniżej.
        bg800: '800px',
      },
      colors: {
        brand: {
          50: '#effafa',
          100: '#dbf3f5',
          200: '#b8e8ea',
          300: '#88d8dd',
          400: '#4dc5cb',
          500: '#30a0a6',
          600: '#24757a',
          700: '#1b5b5f',
          800: '#134449',
          900: '#0d3135',
          950: '#081e21',
        },
      },
      fontFamily: {
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Poppins"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 10px 30px -12px rgba(19, 68, 73, 0.25)',
        card: '0 1px 2px rgba(13, 49, 53, 0.06), 0 8px 24px -8px rgba(13, 49, 53, 0.12)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #0d3135 0%, #1b5b5f 45%, #30a0a6 100%)',
        'brand-gradient-soft': 'linear-gradient(135deg, #effafa 0%, #dbf3f5 100%)',
      },
    },
  },
  plugins: [],
};
