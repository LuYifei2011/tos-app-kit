import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    target: 'es2022', emptyOutDir: false,
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js', cssFileName: 'style' },
    rollupOptions: { external: ['vue', 'tos-app-core', 'tos-app-core/vue'] },
  },
})
