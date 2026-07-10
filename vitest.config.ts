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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      // PURE-CORE allowlist: IO-free transform modules whose logic is unit-tested in
      // the wired lanes (orchestra project). The CLI entrypoints (bin/*.ts) do the IO;
      // these modules are socket/disk-free so every branch is deterministically covered.
      // IO-heavy / server-boot / CLI-loop modules are deliberately NOT listed — including
      // them would either inflate the glob with untested code or force a false threshold.
      include: [
        'orchestration/bin/lib/autopilot.ts',
        'orchestration/bin/lib/bench.ts',
        'orchestration/bin/lib/council.ts',
        'orchestration/bin/lib/deps.ts',
        'orchestration/bin/lib/hierarchy.ts',
        'orchestration/bin/lib/joker.ts',
        'orchestration/bin/lib/optimize.ts',
        'orchestration/bin/lib/orchestra-fsm.ts',
        'orchestration/bin/lib/task-catalog.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/tests/**',
        '**/*.mjs',
        '**/dist/**',
        '**/node_modules/**',
      ],
      // Honest floor on the pure-core lane. branches/functions start conservative
      // (below current) so a later refactor that legitimately drops a branch does
      // not red the gate; lines is the load-bearing threshold.
      thresholds: { lines: 70, functions: 70, branches: 60 },
    },
    projects: [
      {
        // existing backend suite — behavior unchanged
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          // GW-2 (v1.29.3): co-located gateway verify suites (server/**, host-bridge mjs)
          // run in the same deterministic node lane as tests/**.
          include: ['tests/**/*.test.ts', 'server/**/*.test.ts', 'bin/host-bridge/**/*.test.mjs'],
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
          include: ['orchestration/tests/{orchestra-fsm,orchestra-chaos,orchestra-repair,orchestra-live,joker,council-vote,autopilot-stale,task-catalog,task-progress,deps,math-properties,bench,optimize,benchmark-honesty,hierarchy,claude-dispatch,dod-lanes,lane-triage,converge,finish,build-tasks,calibrate,deps-doctor,gen-catalog,keys-health,orchestra,refresh-catalog}.test.ts'],
        },
      },
    ],
  },
});
