// Orchestration-scoped vitest config. Plain object (no imports) → worktree'de node_modules
// gerektirmez; root vite.config.ts (@tailwindcss/vite) kontaminasyonunu by-pass eder (ERR-SCR-002 dersi).
// Koş: ~/Desktop/ollamas/node_modules/.bin/vitest run --config orchestration/vitest.config.ts
export default {
  test: {
    include: ["orchestration/tests/**/*.test.ts"],
  },
};
