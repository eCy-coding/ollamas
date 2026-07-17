// P4 — backup with restore-verification + MRR maths. Deterministic (fake embedder,
// temp dirs); the live-embedder MRR path is `make eval-brain-mrr`, not this suite.
import { describe, test, expect } from "vitest";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBrainStore } from "../server/brain";
import { backupBrain } from "../scripts/brain-backup";
import { computeMrr } from "../scripts/brain-eval-mrr";

const fakeEmbed = async (t: string) => {
  const v = [0, 0, 0];
  v[t.length % 3] = 1;
  return v;
};

const tmp = () => mkdtempSync(path.join(tmpdir(), "brain-backup-test-"));

describe("brain-backup — verified snapshot + retention", () => {
  test("backup copies, verifies row counts, and reports them", async () => {
    const dir = tmp();
    const dbPath = path.join(dir, "brain.db");
    const b = createBrainStore({ dbPath, embed: fakeEmbed });
    await b.remember({ id: "m1", tier: "learned", content: "alpha" });
    await b.remember({ id: "m2", tier: "core", content: "beta" });
    await b.assertFact({ subject: "s", predicate: "p", object: "o" });
    b.close();

    const day = 86_400_000;
    const r = backupBrain({ dbPath, dir: path.join(dir, "backups"), now: () => 10 * day });
    expect(existsSync(r.dest)).toBe(true);
    expect(r.memories).toBe(2);
    expect(r.facts).toBe(1);
    expect(r.bytes).toBeGreaterThan(0);
  });

  test("retention keeps only the newest N snapshots", async () => {
    const dir = tmp();
    const dbPath = path.join(dir, "brain.db");
    const b = createBrainStore({ dbPath, embed: fakeEmbed });
    await b.remember({ id: "m1", tier: "learned", content: "alpha" });
    b.close();

    const day = 86_400_000;
    const backups = path.join(dir, "backups");
    for (let d = 1; d <= 4; d++) backupBrain({ dbPath, dir: backups, keep: 2, now: () => d * day });
    const left = readdirSync(backups).filter((f) => f.endsWith(".db"));
    expect(left).toHaveLength(2);
    expect(left.sort().at(-1)).toBe("brain-1970-01-05.db"); // 4*day → 5 Jan; newest survives
  });
});

describe("brain MRR — pure maths", () => {
  test("perfect top-1 everywhere = 1.0; absent = 0; mixed averages reciprocals", () => {
    expect(computeMrr([1, 1, 1])).toBe(1);
    expect(computeMrr([null, null])).toBe(0);
    expect(computeMrr([1, 2, null, 4])).toBeCloseTo((1 + 0.5 + 0 + 0.25) / 4, 10);
    expect(computeMrr([])).toBe(0);
  });
});
