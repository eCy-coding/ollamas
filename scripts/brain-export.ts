// Brain portable dump (S22) — versioned vector-free JSON to stdout or OUT= file.
// Read-only; safe alongside the live server (WAL). Usage:
//   make brain-export            # stdout
//   make brain-export OUT=dump.json
import { writeFileSync } from "node:fs";
import { exportBrain } from "../server/brain-portable";

function main() {
  const dbPath = process.env.BRAIN_DB_PATH || `${process.env.HOME}/.llm-mission-control/brain.db`;
  const dump = exportBrain(dbPath);
  const payload = JSON.stringify({ ...dump, exportedAt: Date.now(), source: dbPath });
  const out = process.env.OUT || process.argv[2];
  if (out) {
    writeFileSync(out, payload);
    console.log(JSON.stringify({
      event: "brain.export", out, memories: dump.memories.length, facts: dump.facts.length, bytes: payload.length,
    }));
  } else {
    process.stdout.write(payload + "\n");
  }
}

main();
