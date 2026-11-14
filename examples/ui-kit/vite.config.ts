import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [vue()], base: './',
  build: { target: 'es2022', outDir: '../../build/ui-kit-example', emptyOutDir: true },
})
