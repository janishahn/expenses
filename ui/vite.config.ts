import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8000"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        if (
          warning.message.includes("dynamically imported by") &&
          warning.message.includes("but also statically imported by") &&
          warning.message.includes("/src/components/phosphorUtils.ts")
        ) {
          return
        }
        warn(warning)
      },
      output: {
        manualChunks(id) {
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/react-router-dom/")
          ) {
            return "react"
          }
          if (id.includes("/node_modules/@tanstack/react-query/")) {
            return "query"
          }
          if (
            id.includes("/node_modules/chart.js/") ||
            id.includes("/node_modules/react-chartjs-2/")
          ) {
            return "charts"
          }
          if (
            id.includes("/node_modules/@tiptap/") ||
            id.includes("/node_modules/prosemirror-") ||
            id.includes("/node_modules/tiptap-markdown/") ||
            id.includes("/node_modules/markdown-it/")
          ) {
            return "tiptap"
          }
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": apiProxyTarget,
    },
  },
})
