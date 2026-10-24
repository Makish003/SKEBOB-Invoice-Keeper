/// <reference types="vitest/config" />
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  server: {
    // Dev: API через nginx из docker compose (порт 8080) или напрямую: VITE_API_PROXY=http://localhost:8000
    proxy: { '/api': process.env.VITE_API_PROXY ?? 'http://localhost:8080' },
  },
})
