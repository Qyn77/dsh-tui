import { defineConfig } from 'astro/config';

// GitHub Pages serves a project site from https://qyn77.github.io/dsh-tui/,
// so every asset and internal link has to be rooted at that subpath.
// With a custom domain later, drop `base` (or set it to '/').
export default defineConfig({
  site: 'https://qyn77.github.io',
  base: '/dsh-tui',
  outDir: './dist',
});
