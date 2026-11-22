import { defineConfig } from 'vitest/config'

export default defineConfig({
  build: { target: 'es2022' },
  test: { globals: false, include: ['src/**/*.test.ts'] },
})
