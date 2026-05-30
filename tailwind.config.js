/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0A0E27',
        foreground: '#FFFFFF',
        primary: {
          DEFAULT: '#00D4FF',
          foreground: '#0A0E27',
        },
        secondary: {
          DEFAULT: '#1A2335',
          foreground: '#FFFFFF',
        },
        accent: {
          DEFAULT: '#D4AF37',
          foreground: '#0A0E27',
        },
        destructive: {
          DEFAULT: '#EF4444',
          foreground: '#FFFFFF',
        },
        success: {
          DEFAULT: '#10B981',
          foreground: '#FFFFFF',
        },
        card: 'rgba(15, 25, 50, 0.7)',
        border: 'rgba(0, 212, 255, 0.1)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { textShadow: '0 0 5px #00D4FF' },
          '100%': { textShadow: '0 0 20px #00D4FF, 0 0 30px #D4AF37' },
        },
      },
    },
  },
  plugins: [],
}
