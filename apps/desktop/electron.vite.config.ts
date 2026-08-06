import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: ['@canvas-agent/contracts', '@canvas-agent/domain']
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: {
        exclude: ['@canvas-agent/contracts', '@canvas-agent/domain']
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
