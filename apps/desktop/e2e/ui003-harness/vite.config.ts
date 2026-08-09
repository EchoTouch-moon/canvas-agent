import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: resolve(__dirname, '../..'),
  resolve: {
    alias: {
      '@': resolve(__dirname, '../../src/renderer/src')
    }
  },
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 4179,
    strictPort: true
  }
})
