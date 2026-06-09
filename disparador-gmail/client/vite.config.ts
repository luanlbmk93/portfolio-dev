import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/disparador-gmail/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/disparador-gmail/api': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
    },
  },
})