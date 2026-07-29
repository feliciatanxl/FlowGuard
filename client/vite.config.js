import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react()
  ],
  server: {
    // Listen on every local interface so the same dev server works from both
    // localhost and another device on the laptop's current Wi-Fi/hotspot.
    host: '0.0.0.0',
    proxy: {
      '/user': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
        secure: false,
      },
      '/api': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
        secure: false,
      }
      // NOTE: the old '/ai' proxy straight to the Python service is gone —
      // ALL AI traffic (including /api/yolo/*) now goes through the Node
      // backend, which authenticates the user and calls the private AI
      // service itself. The browser never talks to FastAPI directly.
    }
  }
})
