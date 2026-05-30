import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [
    react(),
    basicSsl()
  ],
  server: {
    proxy: {
      '/user': {
        target: 'http://127.0.0.1:5000', // Routes login requests to Node
        changeOrigin: true,
        secure: false,
      },
      '/api': {
        target: 'http://localhost:5000', // Routes your other backend Node APIs
        changeOrigin: true,
        secure: false,
      },
      // 🎯 ADD THIS: Special secure proxy highway directly to Python
      '/ai': {
        target: 'http://localhost:8500', 
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/ai/, '') // Strips '/ai' before hitting Python
      }
    }
  }
})