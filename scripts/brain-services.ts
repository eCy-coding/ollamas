// Brain services runner (S28) — the "%100 e2e integrated" proof machine.
//   make brain-services            # run every selftest (network probes included)
//   make brain-services OFFLINE=1  # skip kind:"network" (no :3000 required)
//   npx tsx scripts/brain-services.ts --list
// One line per service (ok/evidence), summary, registry snapshot written to
// ~/.llm-mission-control/brain-services.json (state dir, never the repo).
// Exit 1 on any red — CI/cron gate-able, mirrors the orchestration runner.
import { writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BRAIN_SERVICES, validateBrainRegistry, registrySummary } from "../server/brain-services";

async function main() {
  const list = process.argv.includes("--list");
  const offline = process.argv.includes("--offline") || process.env.OFFLINE === "1";

  const v = validateBrainRegistry(BRAIN_SERVICES, { expectCount: 50 });
  if (!v.ok) {
    console.error(JSON.stringify({ event: "brain.services.invalid", problems: v.problems }));
    process.exit(1);
  }
  if (list) {
    for (const s of BRAIN_SERVICES) {
      console.log(`${s.id.padEnd(18)} ${s.kind.padEnd(8)} ${s.role}  [${s.source}]`);
    }
    console.log(JSON.stringify({ event: "brain.services.list", ...registrySummary(BRAIN_SERVICES) }));
    return;
  }

  let red = 0;
  let skipped = 0;
  const results: { id: string; kind: string; ok: boolean; evidence: string; ms: number }[] = [];
  for (const s of BRAIN_SERVICES) {
    if (offline && s.kind === "network") {
      skipped++;
      results.push({ id: s.id, kind: s.kind, ok: true, evidence: "SKIPPED (offline)", ms: 0 });
      console.log(`○ ${s.id.padEnd(18)} SKIPPED (offline)`);
      continue;
    }
    const t0 = Date.now();
    let ok = false;
    let evidence = "";
    try {
      const r = await s.selftest();
      ok = r.ok;
      evidence = r.evidence;
    } catch (e) {
      evidence = `selftest threw: ${(e as Error).message}`;
    }
    const ms = Date.now() - t0;
    results.push({ id: s.id, kind: s.kind, ok, evidence, ms });
    console.log(`${ok ? "✓" : "✗"} ${s.id.padEnd(18)} ${evidence} (${ms}ms)`);
    if (!ok) red++;
  }

  const summary = {
    event: "brain.services.health",
    total: BRAIN_SERVICES.length,
    green: BRAIN_SERVICES.length - red - skipped,
    red,
    skipped,
    at: new Date().toISOString(),
  };
  console.log(JSON.stringify(summary));
  try {
    const dir = path.join(process.env.HOME || os.homedir(), ".llm-mission-control");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "brain-services.json"), JSON.stringify({ ...summary, results }, null, 2));
  } catch { /* snapshot is best-effort */ }
  if (red > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
