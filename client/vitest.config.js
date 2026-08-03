import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // The UI suites create full jsdom/React trees. Bounding concurrency avoids
    // CPU starvation causing unrelated 5-second async assertions to time out.
    maxWorkers: 4,
  },
})
