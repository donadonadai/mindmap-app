import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// 独自ドメイン(mindmap.nobleme.co.jp)のルートで配信するため base は '/'。
export default defineConfig({
  base: '/',
  plugins: [react()],
})
