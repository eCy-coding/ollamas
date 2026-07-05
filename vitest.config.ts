import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

// Frontend lane (vF1) test config. Node backend tests and jsdom UI tests are
// isolated via `projects` because Vitest 4 removed `environmentMatchGlobs`.
// Backend tests keep running exactly as before (node env, tests/*.test.ts).
//
// vNEXT-A2: E2E / live-HTTP suites boot real servers + bind ports → nondeterministic in the
// parallel pre-commit gate (random files fail under load). They are EXCLUDED from the default
// `npm run test` (fast deterministic gate) and run only under PERF=1 (`npm run test:perf`, CI).
// Nothing is deleted — moved to the perf/integration lane.
const RUN_E2E = !!process.env.PERF;
const E2E_GLOBS = [
  'tests/**/*.e2e.test.ts',
  'tests/ukp-ingest-http.test.ts',
  'tests/oauth-client-credentials.test.ts',
];

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
          exclude: ['tests/ui/**', ...(RUN_E2E ? [] : E2E_GLOBS)],
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
      {
        // orchestra conductor lane — the $0 Claude-Code-free conductor + joker failover FSM.
        // Scoped to these files (the wider orchestration/tests/** suite is not yet gate-wired).
        extends: true,
        test: {
          name: 'orchestra',
          environment: 'node',
          include: ['orchestration/tests/{orchestra-fsm,orchestra-chaos,orchestra-repair,orchestra-live,joker,council-vote,autopilot-stale,task-catalog}.test.ts'],
        },
      },
    ],
  },
});
