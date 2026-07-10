/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: {
          primary: 'var(--background-primary)',
          secondary: 'var(--background-secondary)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
        },
        accent: {
          primary: 'var(--accent-primary)',
          secondary: 'var(--accent-secondary)',
        },
        border: {
          color: 'var(--border-color)',
        },
      },
      boxShadow: {
        'cyberpunk': '0 0 15px rgba(255, 0, 255, 0.3), 0 0 25px rgba(0, 255, 255, 0.2)',
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s infinite',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 10px rgba(255, 0, 255, 0.3)' },
          '50%': { boxShadow: '0 0 25px rgba(0, 255, 255, 0.5)' },
        }
      }
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
