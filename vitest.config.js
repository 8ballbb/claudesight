import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    root: '.',
    environment: 'node',
    // .jsx too: component tests mount real components, and those test files
    // carry JSX themselves.
    include: ['tests/**/*.test.js', 'tests/**/*.test.jsx'],
  },
})
