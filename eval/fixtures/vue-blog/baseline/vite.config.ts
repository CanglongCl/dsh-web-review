import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  cacheDir: '.vite',
  server: { port: 0 },
})
