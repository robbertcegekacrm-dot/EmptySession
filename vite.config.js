import { defineConfig } from 'vite';

// On GitHub Pages the site is served from /<repo-name>/. In Actions GITHUB_REPOSITORY is
// "owner/repo"; locally it is unset and the app is served from the root.
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];

export default defineConfig({
  base: repo ? `/${repo}/` : '/',
});
