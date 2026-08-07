/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: '#0e0e10',
        panel: {
          DEFAULT: '#161619',
          2: '#1d1d21',
          3: '#26262b'
        },
        line: '#2b2b31',
        cream: '#f2efe6',
        muted: '#9b9aa3',
        accent: {
          DEFAULT: '#f26522',
          hover: '#ff7a3d',
          soft: 'rgba(242, 101, 34, 0.14)'
        },
        agent: {
          running: '#3ecf8e',
          paused: '#eab308',
          stopped: '#ef4444',
          idle: '#6b7280'
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
