import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';
import tailwindcssTypography from '@tailwindcss/typography';

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Shadcn-inspired theme using CSS variables
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
          hover: 'hsl(var(--accent-foreground))',
          blue: '#6b7280', // Kept for backward compatibility, now neutral gray
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        'background-card': 'hsl(var(--card))',
        text: 'hsl(var(--foreground))',
        'text-secondary': 'hsl(var(--foreground))',
        'text-muted': 'hsl(var(--muted-foreground))',
        danger: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        warning: {
          DEFAULT: '#EE7909',
        },
        success: {
          DEFAULT: '#019E55',
        },
        'provider-bg': 'hsl(var(--provider-bg))',
        'provider-bg-active': 'hsl(var(--provider-bg-active))',
        'provider-bg-hover': 'hsl(var(--provider-bg-hover))',
        'provider-border-active': 'hsl(var(--provider-border-active))',
        'provider-accent': 'hsl(var(--provider-accent))',
        'provider-accent-text': 'hsl(var(--provider-accent-text))',
        'todo-progress-pending': 'hsl(var(--todo-progress-pending))',
        'todo-item-completed': 'hsl(var(--todo-item-completed))',
        'todo-item-in-progress': 'hsl(var(--todo-item-in-progress))',
      },
      boxShadow: {
        sm: '0 1px 2px 0px hsl(230 25% 20% / 0.05), 0 1px 3px -1px hsl(230 25% 20% / 0.06)',
        DEFAULT: '0 1px 3px 0px hsl(230 25% 20% / 0.07), 0 1px 2px -1px hsl(230 25% 20% / 0.06)',
        md: '0 2px 6px -1px hsl(230 25% 20% / 0.08), 0 1px 3px -1px hsl(230 25% 20% / 0.06)',
        lg: '0 4px 12px -2px hsl(230 25% 20% / 0.10), 0 2px 4px -2px hsl(230 25% 20% / 0.06)',
        xl: '0 8px 24px -4px hsl(230 25% 20% / 0.12), 0 2px 8px -2px hsl(230 25% 20% / 0.06)',
        '2xl': '0 16px 40px -6px hsl(230 25% 20% / 0.16)',
        card: '0 1px 3px 0px hsl(230 25% 20% / 0.06), 0 1px 2px -1px hsl(230 25% 20% / 0.05)',
        'card-hover': '0 4px 16px -3px hsl(220 10% 16% / 0.08), 0 2px 6px -2px hsl(220 10% 16% / 0.06)',
      },
      borderRadius: {
        sm: 'calc(var(--radius) * 0.6)',
        DEFAULT: 'var(--radius)',
        md: 'var(--radius)',
        lg: 'calc(var(--radius) * 1.4)',
        xl: 'calc(var(--radius) * 1.8)',
        '2xl': 'calc(var(--radius) * 2.2)',
        '3xl': 'calc(var(--radius) * 2.8)',
        card: 'calc(var(--radius) * 1.6)',
      },
      fontFamily: {
        sans: [
          'Geist',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        apparat: ['KMR Apparat', 'Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      transitionTimingFunction: {
        navigator: 'cubic-bezier(0.64, 0, 0.78, 0)',
      },
      animation: {
        shimmer: 'shimmer 2s infinite',
        'spin-ccw': 'spinCcw 1s linear infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        spinCcw: {
          '0%': { transform: 'rotate(360deg)' },
          '100%': { transform: 'rotate(0deg)' },
        },
      },
    },
  },
  plugins: [tailwindcssAnimate, tailwindcssTypography],
};

export default config;
