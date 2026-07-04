// oracle-serve seams — the daemon (orchestration/bin/oracle-serve.ts) calls server.listen at import
// (main-only, no exports → NOT importable in tests). tests/oracle.test.ts covers the verdict core; here we
// replicate the daemon's NDJSON line-protocol handler + buffer framing 1:1 and test the protocol seams —
// request routing (single / batch / ping / clear), memo visibility, hostile-input error paths, and chunked
// framing — with NO socket. Only exec-free oracle inputs are used (no subprocess).
import { describe, it, expect, beforeEach } from "vitest";
import { verify, verifyMany, clearMemo, memoSize, type OracleInput } from "../oracle/index";

// The daemon's per-line handler, replicated verbatim: parse → batch | ping | clear | verify; catch → daemon-error.
async function handleLine(line: string): Promise<any> {
  try {
    const msg = JSON.parse(line) as { batch?: OracleInput[]; cmd?: string };
    if (msg && Array.isArray(msg.batch)) return { results: await verifyMany(msg.batch) };
    if (msg && msg.cmd === "ping") return { ok: true, memo: memoSize() };
    if (msg && msg.cmd === "clear") { clearMemo(); return { ok: true }; }
    return verify(msg as OracleInput);
  } catch (e) {
    return { verdict: "UNDECIDABLE", basis: "daemon-error", proof: String((e as Error).message) };
  }
}

// The daemon's NDJSON framing loop, replicated verbatim: append → split on "\n" → trim → skip empty lines.
function frame(state: { buf: string }, chunk: string): string[] {
  state.buf += chunk;
  const lines: string[] = [];
  let nl: number;
  while ((nl = state.buf.indexOf("\n")) >= 0) {
    const line = state.buf.slice(0, nl).trim();
    state.buf = state.buf.slice(nl + 1);
    if (line) lines.push(line);
  }
  return lines;
}

beforeEach(() => clearMemo());

describe("oracle-serve line protocol — single verdict request", () => {
  it("a JSON-string claim line routes to verify and returns the verdict object", async () => {
    expect(await handleLine(`"2+2=4"`)).toMatchObject({ verdict: "TRUE", category: "arithmetic" });
    expect(await handleLine(`"2+2=5"`)).toMatchObject({ verdict: "FALSE", category: "arithmetic" });
  });
});

describe("oracle-serve line protocol — batch request", () => {
  it(`{"batch":[...]} → {"results":[...]} preserving input order`, async () => {
    const resp = await handleLine(JSON.stringify({ batch: ["2+2=4", "after 5 comes 7", "the sky is nice"] }));
    expect(resp.results).toHaveLength(3);
    expect(resp.results.map((r: any) => r.verdict)).toEqual(["TRUE", "FALSE", "UNDECIDABLE"]);
    expect(resp.results[1].category).toBe("ordering"); // order preserved, not sorted by completion
  });
});

describe("oracle-serve memo commands (the daemon's whole reason to exist: a HOT cache)", () => {
  it("ping reports live memo size; clear empties it", async () => {
    expect(await handleLine(`{"cmd":"ping"}`)).toEqual({ ok: true, memo: 0 });
    await handleLine(`"2+2=4"`);
    await handleLine(`"1<2"`);
    expect(await handleLine(`{"cmd":"ping"}`)).toEqual({ ok: true, memo: 2 });
    expect(await handleLine(`{"cmd":"clear"}`)).toEqual({ ok: true });
    expect(await handleLine(`{"cmd":"ping"}`)).toEqual({ ok: true, memo: 0 });
  });
});

describe("oracle-serve protocol error paths — the daemon must NEVER crash or emit unframeable output", () => {
  it("malformed JSON → daemon-error UNDECIDABLE, serialized to a single NDJSON-safe line", async () => {
    const resp = await handleLine("{not json");
    expect(resp).toMatchObject({ verdict: "UNDECIDABLE", basis: "daemon-error" });
    expect(typeof resp.proof).toBe("string");
    expect(JSON.stringify(resp)).not.toContain("\n"); // one response = one line (NDJSON invariant)
  });

  it(`hostile "null" line (valid JSON, invalid OracleInput) is caught → daemon-error, not a crash`, async () => {
    const resp = await handleLine("null");
    expect(resp).toMatchObject({ verdict: "UNDECIDABLE", basis: "daemon-error" });
  });
});

describe("oracle-serve NDJSON framing — chunked input, CRLF, blank lines, partial tail", () => {
  it("reassembles split lines, tolerates \\r\\n + blanks, and holds an unterminated tail in the buffer", async () => {
    const st = { buf: "" };
    expect(frame(st, `"2+`)).toEqual([]); // mid-line chunk → nothing emitted yet
    expect(frame(st, `2=4"\r\n\n"1<2"\n"tail`)).toEqual([`"2+2=4"`, `"1<2"`]); // \r trimmed, blank skipped
    expect(st.buf).toBe(`"tail`); // partial line stays buffered until its newline arrives
    const verdicts = await Promise.all(frame(st, `"\n`).map(handleLine));
    expect(verdicts).toHaveLength(1); // completing the tail emits exactly one more request
    const all = await Promise.all([`"2+2=4"`, `"1<2"`].map(handleLine));
    expect(all.map((r: any) => r.verdict)).toEqual(["TRUE", "TRUE"]);
  });
});
