import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

// Frontend lane (vF1) test config. Node backend tests and jsdom UI tests are
// isolated via `projects` because Vitest 4 removed `environmentMatchGlobs`.
// Backend tests keep running exactly as before (node env, tests/*.test.ts).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    projects: [
      {
        // existing backend suite — behavior unchanged
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/ui/**'],
        },
      },
      {
        // frontend React component suite
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['tests/ui/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/ui/setup.ts'],
        },
      },
      {
        // scripts lane (v2) — host-bridge / shell / tool harness, node env
        extends: true,
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/tests/**/*.test.ts'],
        },
      },
    ],
  },
});
