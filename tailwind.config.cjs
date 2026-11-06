/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), panel: v('panel'), raised: v('raised'), line: v('line'),
        fg: v('fg'), muted: v('muted'), faint: v('faint'),
        accent: v('accent'), accent2: v('accent2'), ok: v('ok'), warn: v('warn'), bad: v('bad'),
        paper: v('paper'), ink: v('ink')
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'Segoe UI Variable', 'Segoe UI', 'system-ui', 'sans-serif'],
        display: ['"Fraunces"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'Cascadia Code', 'Consolas', 'monospace']
      },
      borderRadius: { xl: '14px', '2xl': '20px' },
      keyframes: {
        fadein: { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } }
      },
      animation: { fadein: 'fadein .35s cubic-bezier(.2,.7,.2,1) backwards' }
    }
  },
  plugins: []
}
