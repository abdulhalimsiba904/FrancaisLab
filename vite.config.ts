import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { developmentApiProxy } from './server/devProxy.js'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': developmentApiProxy,
    },
  },
})
