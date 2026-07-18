// Standalone consistency sentinel run (S25) — one JSON report line, exit 0 always
// (report-only contract; brain-maintain carries the same check nightly).
// Usage: make brain-check  |  npx tsx scripts/brain-check.ts [db-path]
import { checkConsistencyAt } from "../server/brain-consistency";

const dbPath =
  process.argv[2] || process.env.BRAIN_DB_PATH || `${process.env.HOME}/.llm-mission-control/brain.db`;
console.log(JSON.stringify({ event: "brain.consistency", dbPath, ...checkConsistencyAt(dbPath) }));
