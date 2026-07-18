// Coherence audit — "semantik bağı olmayan gereksizleri tespit et": every knowledge
// record is scored by max cosine similarity to the ollamas-core anchor set. Low-bond
// AND never-recalled records get QUARANTINED (confidence→0.4 — recall already
// penalizes it; nothing is deleted, re-runs restore records whose bond recovered).
// Usage: make brain-coherence (report+apply). Audit-ledger records every change.
import { DatabaseSync } from "node:sqlite";
import * as sqliteVec from "sqlite-vec";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveEmbedder } from "../server/rag";

export const ANCHORS = [
  "ollamas server brain provider tool registry mission control",
  "brain memory recall embedding sqlite vector search",
  "macbook sistem servis launchd disk bellek",
  "yazılım geliştirme typescript git test komut terminal",
  "ağ http api port istek sunucu",
  "emre proje hedef plan çalışma prensibi",
];

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export function maxAnchorBond(vec: number[], anchorVecs: number[][]): number {
  return Math.max(...anchorVecs.map((av) => cosine(vec, av)));
}

/** Pure verdict: quarantine only when bond is low AND the record never earned a recall. */
export function verdict(bond: number, hits: number, threshold = 0.35): "keep" | "quarantine" {
  return bond < threshold && hits === 0 ? "quarantine" : "keep";
}

async function main() {
  const apply = process.argv.includes("--apply");
  const dbPath = process.env.BRAIN_DB_PATH || join(homedir(), ".llm-mission-control", "brain.db");
  const db = new DatabaseSync(dbPath, { allowExtension: true });
  sqliteVec.load(db);
  db.exec("PRAGMA busy_timeout=5000");
  const { embed } = resolveEmbedder();
  const budget = (t: string) => Promise.race([
    embed(t),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("embed budget")), 6000)),
  ]);
  const anchorVecs: number[][] = [];
  for (const a of ANCHORS) anchorVecs.push(await budget(a));
  const rows = db.prepare(
    "SELECT rowid, mem_id AS id, content, access_count AS hits, confidence FROM brain_memories WHERE ns='knowledge'",
  ).all() as { rowid: number; id: string; content: string; hits: number; confidence: number | null }[];
  const perSet: Record<string, { n: number; bondSum: number; quarantined: number }> = {};
  let skipped = 0, quarantined = 0, restored = 0;
  for (const r of rows) {
    const set = (r.id.match(/^teach:([^:]+):/) || [, "other"])[1] as string;
    perSet[set] ??= { n: 0, bondSum: 0, quarantined: 0 };
    let bond: number;
    try {
      bond = maxAnchorBond(await budget(String(r.content).slice(0, 300)), anchorVecs);
    } catch { skipped++; continue; }
    perSet[set].n++; perSet[set].bondSum += bond;
    const v = verdict(bond, r.hits ?? 0);
    if (apply) {
      if (v === "quarantine" && (r.confidence ?? 1) > 0.4) {
        db.prepare("UPDATE brain_memories SET confidence=0.4 WHERE rowid=?").run(BigInt(r.rowid));
        db.prepare("INSERT INTO brain_audit(ts, action, mem_id, detail) VALUES(?,?,?,?)")
          .run(Date.now(), "quarantine", r.id, `coherence bond=${bond.toFixed(3)} hits=0 → conf 0.4`);
        quarantined++; perSet[set].quarantined++;
      } else if (v === "keep" && r.confidence === 0.4) {
        db.prepare("UPDATE brain_memories SET confidence=0.95 WHERE rowid=?").run(BigInt(r.rowid));
        db.prepare("INSERT INTO brain_audit(ts, action, mem_id, detail) VALUES(?,?,?,?)")
          .run(Date.now(), "restore", r.id, `coherence bond=${bond.toFixed(3)} recovered`);
        restored++;
      }
    } else if (v === "quarantine") quarantined++;
  }
  const summary = Object.entries(perSet)
    .map(([set, x]) => ({ set, n: x.n, avgBond: x.n ? Number((x.bondSum / x.n).toFixed(3)) : 0, quarantined: x.quarantined }))
    .sort((a, b) => a.avgBond - b.avgBond);
  writeFileSync("docs/BRAIN-COHERENCE.md",
    `# BRAIN-COHERENCE — semantik-bağ denetimi (${new Date().toISOString().slice(0, 16)})\n\n` +
    `Anchor: ollamas-çekirdek amaç sorguları. Karantina = bağ<0.35 VE hits=0 → confidence 0.4 (SİLME YOK, bağ toparlanırsa geri döner).\n\n` +
    `| Set | Kayıt | Ort. bağ | Karantina |\n|---|---|---|---|\n` +
    summary.map((s) => `| ${s.set} | ${s.n} | ${s.avgBond} | ${s.quarantined} |`).join("\n") + "\n");
  console.log(JSON.stringify({ event: "brain.coherence", apply, records: rows.length, quarantined, restored, skipped, worst: summary.slice(0, 3) }));
  db.close();
}
if (process.argv[1]?.includes("brain-coherence-audit")) void main();
