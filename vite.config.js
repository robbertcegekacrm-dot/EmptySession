import { defineConfig, loadEnv } from 'vite';
import { supabaseKeyProblem } from './scripts/check-key.js';

// On GitHub Pages the site is served from /<repo-name>/. In Actions GITHUB_REPOSITORY is
// "owner/repo"; locally it is unset and the app is served from the root.
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];

export default defineConfig(({ mode }) => {
  // loadEnv reads .env files and process.env (repository variables in Actions).
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const problem = supabaseKeyProblem(env.VITE_SUPABASE_ANON_KEY);
  if (problem) throw new Error(`${problem} Refusing to build: this key would be published in the browser bundle.`);

  return {
    base: repo ? `/${repo}/` : '/',
  };
});
