/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Palette « carte de roman » : encre, parchemin, sépia. Voir docs/rendu.md.
      colors: {
        ink: { DEFAULT: '#2b2118', soft: '#5a4a38' },
        parchment: { DEFAULT: '#e8dcc0', dark: '#d4c4a0', deep: '#bda87f' },
        sea: { DEFAULT: '#8fa8ae', deep: '#5f7f89' },
      },
      fontFamily: {
        serif: ['Georgia', 'Cambria', 'Times New Roman', 'serif'],
      },
    },
  },
  plugins: [],
};
