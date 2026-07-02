/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // High-end curated slate & indigo color theme
        brand: {
          50: '#f5f7fa',
          100: '#eaeef4',
          200: '#d5dde9',
          300: '#b3c4da',
          400: '#8ca2c4',
          500: '#6981ad',
          600: '#526792',
          700: '#435377',
          800: '#3a4662',
          900: '#323c52',
          950: '#1b202e',
        },
      },
    },
  },
  plugins: [],
}
