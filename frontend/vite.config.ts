import fs from 'node:fs'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

const certPath = new URL('./certs/localhost-cert.pem', import.meta.url)
const keyPath = new URL('./certs/localhost-key.pem', import.meta.url)
const hasLocalCertificate = fs.existsSync(certPath) && fs.existsSync(keyPath)
const useLocalCertificate = hasLocalCertificate && process.env.SOILSYNC_DISABLE_LOCAL_HTTPS !== '1'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  envDir: '..',
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: useLocalCertificate
      ? {
          cert: fs.readFileSync(certPath),
          key: fs.readFileSync(keyPath),
        }
      : undefined,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    https: useLocalCertificate
      ? {
          cert: fs.readFileSync(certPath),
          key: fs.readFileSync(keyPath),
        }
      : undefined,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
