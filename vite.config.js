import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Relative base so the build works from a GitHub Pages subpath
// (e.g. username.github.io/nostr-galaxy-map/) as well as from
// a Vercel root domain, with no config changes needed.
export default defineConfig({
  base: './',
  plugins: [vue()]
})
