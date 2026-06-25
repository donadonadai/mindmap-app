import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// GitHub Pages のプロジェクトサイト( /mindmap-app/ )で動くよう base を設定。
// ローカル開発(dev)では '/' のままにしたいので、本番ビルド時のみ base を付ける。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/mindmap-app/' : '/',
  plugins: [react()],
}))
