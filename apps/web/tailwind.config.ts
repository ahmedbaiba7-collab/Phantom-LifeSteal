import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Design tokens for LifeSteal Phantom.
 *
 * The palette is black + purple neon per the brief, with one deliberate
 * constraint: `heart` red is reserved for hearts and destructive actions and is
 * used nowhere else. Because it never decorates, its appearance always carries
 * meaning.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#07060B',
        panel: '#0F0B1B',
        raised: '#161027',
        edge: 'rgba(168,85,247,0.16)',
        neon: {
          DEFAULT: '#A855F7',
          hot: '#C77DFF',
          dim: '#6D28D9',
        },
        heart: '#FF2E63',
        ink: '#EDE9FE',
        muted: '#948CAD',
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // A deliberate scale rather than ad-hoc sizes per component.
        eyebrow: ['0.6875rem', { lineHeight: '1', letterSpacing: '0.24em' }],
        display: ['clamp(2.75rem, 9vw, 6.5rem)', { lineHeight: '0.92', letterSpacing: '-0.02em' }],
        headline: ['clamp(1.75rem, 4vw, 3rem)', { lineHeight: '1.05', letterSpacing: '-0.01em' }],
      },
      boxShadow: {
        neon: '0 0 0 1px rgba(168,85,247,0.28), 0 18px 60px -22px rgba(168,85,247,0.55)',
        heart: '0 0 0 1px rgba(255,46,99,0.32), 0 18px 60px -22px rgba(255,46,99,0.5)',
        panel: '0 24px 70px -40px rgba(0,0,0,0.9)',
        'neon-lg': '0 0 0 1px rgba(168,85,247,0.42), 0 26px 80px -24px rgba(168,85,247,0.75)',
      },
      backgroundImage: {
        'grid-fade':
          'linear-gradient(rgba(168,85,247,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(168,85,247,0.07) 1px, transparent 1px)',
      },
      backgroundSize: { grid: '56px 56px' },
      spacing: { '13': '3.25rem' },
      opacity: { '8': '0.08', '12': '0.12', '180': '1' },
      keyframes: {
        drain: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.35', transform: 'scale(0.9)' },
        },
        sweep: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(200%)' },
        },
        rise: {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        drain: 'drain 2.4s ease-in-out infinite',
        sweep: 'sweep 3.5s linear infinite',
        rise: 'rise 0.5s cubic-bezier(0.22,1,0.36,1) both',
      },
    },
  },
  plugins: [animate],
};

export default config;
