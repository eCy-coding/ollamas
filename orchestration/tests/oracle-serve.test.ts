// bin/oracle-serve.ts contract tests — the daemon is socket plumbing around handleOracleLine (extracted
// to bin/lib/oracle-lib.ts, zero behavior change). Every NDJSON request form is tested here hermetically:
// no socket, no daemon process, deterministic.
import { describe, it, expect } from "vitest";
import { handleOracleLine } from "../bin/lib/oracle-lib";
import { verify, memoSize } from "../oracle/index";

describe("handleOracleLine — one NDJSON request → one response", () => {
  it("a JSON string claim → single verdict object", async () => {
    const r = (await handleOracleLine(JSON.stringify("2+2=4"))) as { verdict: string; category: string };
    expect(r.verdict).toBe("TRUE");
    expect(r.category).toBe("arithmetic");
  });

  it("a structured code-rule request → its verdict", async () => {
    const line = JSON.stringify({ kind: "code-rule", code: "db.query(`SELECT * FROM t WHERE id = ${x}`);" });
    const r = (await handleOracleLine(line)) as { verdict: string; basis: string };
    expect(r.verdict).toBe("FALSE");
    expect(r.basis).toBe("CWE-89");
  });

  it('{"batch":[...]} → {"results":[...]} preserving order', async () => {
    const r = (await handleOracleLine(JSON.stringify({ batch: ["2+2=4", "2+2=5", "1<2"] }))) as { results: { verdict: string }[] };
    expect(r.results.map((x) => x.verdict)).toEqual(["TRUE", "FALSE", "TRUE"]);
  });

  it('{"cmd":"ping"} → ok + current memo size', async () => {
    verify("3*3=9"); // warm the memo so it is non-trivially sized
    const r = (await handleOracleLine(JSON.stringify({ cmd: "ping" }))) as { ok: boolean; memo: number };
    expect(r.ok).toBe(true);
    expect(r.memo).toBe(memoSize());
    expect(r.memo).toBeGreaterThan(0);
  });

  it('{"cmd":"clear"} → ok and the memo cache is emptied', async () => {
    verify("5-1=4");
    expect(memoSize()).toBeGreaterThan(0);
    const r = (await handleOracleLine(JSON.stringify({ cmd: "clear" }))) as { ok: boolean };
    expect(r.ok).toBe(true);
    expect(memoSize()).toBe(0);
  });

  it("malformed JSON → UNDECIDABLE daemon-error (the daemon never crashes on bad input)", async () => {
    const r = (await handleOracleLine("{not json")) as { verdict: string; basis: string; proof: string };
    expect(r.verdict).toBe("UNDECIDABLE");
    expect(r.basis).toBe("daemon-error");
    expect(r.proof.length).toBeGreaterThan(0);
  });

  it("memoization across requests: repeated claim answers identically (hot-cache contract)", async () => {
    const a = await handleOracleLine(JSON.stringify("7*6=42"));
    const b = await handleOracleLine(JSON.stringify("7*6=42"));
    expect(b).toEqual(a);
  });
});
