// S24 redaction gate: secrets must never persist in brain.db — not in content,
// not in the FTS index (the embedding is masked implicitly because the masked
// text is what gets embedded). Detection reuses the repo-wide interceptor rules;
// this suite covers the brain-specific mode contract + the ONE enforcement point.
import { describe, test, expect, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createBrainStore } from "../server/brain";
import { redactForBrain, resolveRedactMode } from "../server/brain-redact";

const fakeEmbed = async (t: string) => {
  let h = 7;
  for (const c of t) h = (h * 31 + c.charCodeAt(0)) % 997;
  return [h / 997, ((h * 13) % 997) / 997, 0.5];
};
const tmpDb = () =>
  path.join(os.tmpdir(), `ollamas-redact-${process.pid}-${Math.floor(performance.now() * 1000)}.db`);

const GH_TOKEN = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"; // 36 chars, gitleaks shape
const SECRETY = `deploy note: use token ${GH_TOKEN} for the registry`;

afterEach(() => {
  delete process.env.BRAIN_REDACT;
  delete process.env.BRAIN_REDACT_EMAIL;
});

describe("redactForBrain (pure)", () => {
  test("enforce (default): masks the secret, counts hits", () => {
    const r = redactForBrain(SECRETY, {});
    expect(r.mode).toBe("enforce");
    expect(r.hits).toBe(1);
    expect(r.text).not.toContain(GH_TOKEN);
    expect(r.text).toContain("***REDACTED:github-token***");
  });
  test("report: counts hits but returns the RAW text", () => {
    const r = redactForBrain(SECRETY, { BRAIN_REDACT: "report" });
    expect(r.hits).toBe(1);
    expect(r.text).toBe(SECRETY);
  });
  test("off: untouched, zero accounting", () => {
    expect(redactForBrain(SECRETY, { BRAIN_REDACT: "0" })).toEqual({ text: SECRETY, hits: 0, mode: "off" });
    expect(resolveRedactMode({ BRAIN_REDACT: "off" })).toBe("off");
  });
  test("clean text passes through byte-identical with 0 hits", () => {
    const clean = "operator prefers make ship for deploys";
    const r = redactForBrain(clean, {});
    expect(r).toEqual({ text: clean, hits: 0, mode: "enforce" });
  });
  test("email masked only under BRAIN_REDACT_EMAIL=1", () => {
    const s = "contact emre@example.com for access";
    expect(redactForBrain(s, {}).hits).toBe(0);
    const r = redactForBrain(s, { BRAIN_REDACT_EMAIL: "1" });
    expect(r.hits).toBe(1);
    expect(r.text).not.toContain("emre@example.com");
  });
});

describe("rememberOne enforcement (integration)", () => {
  test("enforce: neither the row nor the FTS index ever contains the secret", async () => {
    const dbPath = tmpDb();
    const b = createBrainStore({ dbPath, embed: fakeEmbed });
    await b.remember({ id: "m-sec", tier: "working", content: SECRETY });
    b.close();
    const db = new DatabaseSync(dbPath);
    const row = db.prepare("SELECT content FROM brain_memories WHERE mem_id='m-sec'").get() as { content: string };
    expect(row.content).not.toContain(GH_TOKEN);
    expect(row.content).toContain("***REDACTED:github-token***");
    const fts = db.prepare("SELECT COUNT(*) AS n FROM brain_fts WHERE content LIKE ?").get(`%${GH_TOKEN}%`) as { n: number };
    expect(Number(fts.n)).toBe(0);
    db.close();
  });

  test("report mode: raw persists (opt-out contract honored)", async () => {
    process.env.BRAIN_REDACT = "report";
    const dbPath = tmpDb();
    const b = createBrainStore({ dbPath, embed: fakeEmbed });
    await b.remember({ id: "m-raw", tier: "working", content: SECRETY });
    b.close();
    const db = new DatabaseSync(dbPath);
    const row = db.prepare("SELECT content FROM brain_memories WHERE mem_id='m-raw'").get() as { content: string };
    expect(row.content).toContain(GH_TOKEN);
    db.close();
  });
});
