// T5-F5 — zero-leak audit: the shared redactor strips secret-shaped substrings from any
// value (deep), and applies to agent tool_call args before they reach the client SSE.
// No cockpit/agent frame may ever carry a raw provider key.
import { describe, it, expect } from "vitest";
import { redactDeep, redactString } from "../server/telemetry";

const SECRETS = [
  "sk-abcdefghijklmnop1234",
  "gsk_LEAKED1234567890abcd",
  "csk-hfkkr2xyzr2fftjy2dn",
  "tvly-dev-abcdefghij12345",
  "pa-70S3lakGWNW1E3ZljYkhr6UNWz3",
  "jina_abcdef1234567890",
];

describe("redactString — secret-shaped substrings", () => {
  it("replaces every known provider key prefix + bearer forms", () => {
    for (const s of SECRETS) {
      expect(redactString(`token=${s} more`)).not.toContain(s);
    }
    expect(redactString("Authorization: Bearer xyz123abc")).toContain("[REDACTED]");
    expect(redactString("normal text, no secret")).toBe("normal text, no secret");
  });
});

describe("redactDeep — walks objects/arrays and scrubs string leaves", () => {
  it("scrubs secrets nested in tool_call args, keeps structure + non-secret values", () => {
    const toolCall = {
      id: "call_1", name: "write_host_file",
      arguments: { path: "/etc/env", content: "GROQ_API_KEY=gsk_LEAKED1234567890abcd\nPORT=3000", note: ["remember", "sk-abcdefghijklmnop1234"] },
    };
    const red = redactDeep(toolCall);
    const s = JSON.stringify(red);
    for (const secret of ["gsk_LEAKED1234567890abcd", "sk-abcdefghijklmnop1234"]) {
      expect(s).not.toContain(secret);
    }
    expect(red.name).toBe("write_host_file");       // structure preserved
    expect(s).toContain("PORT=3000");                // non-secret content kept
    expect(red.arguments.note[0]).toBe("remember");
  });
  it("non-object input passes through / scrubbed as a string", () => {
    expect(redactDeep(42)).toBe(42);
    expect(redactDeep("gsk_LEAKED1234567890abcd")).not.toContain("gsk_LEAKED");
    expect(redactDeep(null)).toBe(null);
  });
  it("survives a CIRCULAR tool_call arg without a stack overflow (still redacts, breaks the cycle)", () => {
    const circular: any = { name: "leak", token: "gsk_LEAKED1234567890abcd" };
    circular.self = circular;          // cycle: without a guard this overflows the stack
    circular.kids = [{ parent: circular, k: "sk-abcdefghijklmnop1234" }];
    const red = redactDeep(circular);  // must NOT throw
    const s = JSON.stringify(red);     // must NOT throw (no circular in the output)
    expect(s).not.toContain("gsk_LEAKED1234567890abcd");
    expect(s).not.toContain("sk-abcdefghijklmnop1234");
    expect(s).toContain("[Circular]");
    expect(red.name).toBe("leak");
  });
});
