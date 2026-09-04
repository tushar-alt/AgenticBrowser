/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Values are RGB triplets defined as CSS variables in styles/index.css
        // and swapped by [data-theme='light'] for the light theme.
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        panel: {
          DEFAULT: 'rgb(var(--c-panel) / <alpha-value>)',
          2: 'rgb(var(--c-panel-2) / <alpha-value>)',
          3: 'rgb(var(--c-panel-3) / <alpha-value>)'
        },
        line: 'rgb(var(--c-line) / <alpha-value>)',
        cream: 'rgb(var(--c-cream) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          hover: 'rgb(var(--c-accent-hover) / <alpha-value>)',
          soft: 'rgb(var(--c-accent) / 0.14)'
        },
        agent: {
          running: 'rgb(var(--c-agent-running) / <alpha-value>)',
          paused: 'rgb(var(--c-agent-paused) / <alpha-value>)',
          stopped: 'rgb(var(--c-agent-stopped) / <alpha-value>)',
          idle: 'rgb(var(--c-agent-idle) / <alpha-value>)'
        }
      },
      fontFamily: {
        body: [
          '"Segoe UI Variable"',
          '"Segoe UI"',
          'system-ui',
          '-apple-system',
          'sans-serif'
        ],
        mono: [
          'ui-monospace',
          '"Cascadia Code"',
          '"JetBrains Mono"',
          '"SF Mono"',
          'Menlo',
          'Consolas',
          'monospace'
        ]
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(242,101,34,0.35), 0 8px 30px -8px rgba(242,101,34,0.35)',
        lift: '0 12px 40px -12px rgba(0,0,0,0.7)'
      },
      letterSpacing: {
        terminal: '0.18em'
      }
    }
  },
  plugins: []
}
