#!/usr/bin/env tsx
/**
 * orchestration/bin/claim.ts — vO7 Work-Claim CLI: bir sekme bir görevi (lane|version) claim eder,
 * böylece paralel sekmeler AYNI işi almaz (duplikasyon kök-fix'i, ERR-ORCH-013).
 *
 * Kullanım:
 *   tsx orchestration/bin/claim.ts <lane> <version>     # claim et (çakışma varsa reddeder)
 *   tsx orchestration/bin/claim.ts --check <lane> <ver> # çakışma var mı (kod 0=boş,3=çakışma)
 *   tsx orchestration/bin/claim.ts --list               # canlı claim'ler
 *   tsx orchestration/bin/claim.ts --renew <lane> <ver> # heartbeat (TTL uzat)
 *   tsx orchestration/bin/claim.ts --done   <lane> <ver># işi bitir
 *   tsx orchestration/bin/claim.ts --release <lane><ver># claim'i bırak
 * Sekme kimliği: $ORCH_TAB (yoksa tab-<pid>). TTL: $ORCH_CLAIM_TTL_MIN dk (default 20).
 * Scope §3: yalnız orchestration/seyir/ altına yazar.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultStore, readClaims, activeClaims, acquireClaim, renewClaim, closeClaim,
  detectCollision, claimKey, type ClaimEvent,
} from "./lib/claims";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEYIR_DIR = join(HERE, "..", "seyir");
const store = defaultStore(SEYIR_DIR);
const TAB = process.env.ORCH_TAB || `tab-${process.pid}`;

export function fmtAge(ms: number): string {
  const m = Math.floor(ms / 60_000);
  return m < 60 ? `${m}dk` : `${Math.floor(m / 60)}s${m % 60}dk`;
}

function printList(): void {
  const now = Date.now();
  const live = activeClaims(readClaims(store), now);
  if (!live.length) { console.log("[claim] canlı claim yok."); return; }
  console.log(`# Canlı claim'ler (${live.length})`);
  for (const c of live) {
    console.log(`- ${claimKey(c.lane, c.version)} → ${c.tab} (pid ${c.pid}, ${fmtAge(now - c.ts)} önce, fence ${c.fence})`);
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const flag = argv.find((a) => a.startsWith("--"));
  const pos = argv.filter((a) => !a.startsWith("--"));
  const [lane, version] = pos;

  if (flag === "--list") { printList(); return; }

  if (flag === "--check") {
    if (!lane || !version) { console.error("kullanım: --check <lane> <version>"); process.exit(2); }
    const c = detectCollision(readClaims(store), lane, version, TAB, Date.now());
    if (c) {
      console.error(`⚠️ ÇAKIŞMA: ${claimKey(lane, version)} zaten ${c.tab} (pid ${c.pid}) tarafından tutuluyor.`);
      process.exit(3);
    }
    console.log(`✓ boş: ${claimKey(lane, version)} claim edilebilir.`);
    return;
  }

  if (flag === "--renew") {
    if (!lane || !version) { console.error("kullanım: --renew <lane> <version>"); process.exit(2); }
    const c = renewClaim(store, { lane, version, tab: TAB, pid: process.pid });
    console.log(`♻️ yenilendi: ${claimKey(lane, version)} (${TAB}, fence ${c.fence})`);
    return;
  }

  if (flag === "--done" || flag === "--release") {
    if (!lane || !version) { console.error(`kullanım: ${flag} <lane> <version>`); process.exit(2); }
    const status = flag === "--done" ? "done" : "released";
    closeClaim(store, { lane, version, tab: TAB, pid: process.pid, status });
    console.log(`${status === "done" ? "✅" : "🔓"} ${status}: ${claimKey(lane, version)} (${TAB})`);
    return;
  }

  // Varsayılan: claim et
  if (!lane || !version) {
    console.error("kullanım: claim.ts <lane> <version> | --list | --check|--renew|--done|--release <lane> <version>");
    process.exit(2);
  }
  const r = acquireClaim(store, { lane, version, tab: TAB, pid: process.pid });
  if (!r.ok) {
    const c = r.collision as ClaimEvent;
    console.error(`⚠️ ÇAKIŞMA: ${claimKey(lane, version)} zaten ${c.tab} (pid ${c.pid}) tutuyor — BAŞKA iş seç.`);
    process.exit(3);
  }
  console.log(`🔒 claim edildi: ${claimKey(lane, version)} → ${TAB} (fence ${r.claim!.fence}). İş bitince: --done ${lane} ${version}`);
}

// Run main() only as a CLI (not when imported by tests).
if (process.argv[1] && /claim\.ts$/.test(process.argv[1])) main();
