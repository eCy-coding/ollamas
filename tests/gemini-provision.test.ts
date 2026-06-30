import { describe, it, expect } from "vitest";
import { parseProjectIds, keyAddUrl, redactKeys, summarize } from "../scripts/gemini-provision.mjs";

describe("gemini-provision pure helpers", () => {
  it("parseProjectIds trims, drops blanks + a header line", () => {
    expect(parseProjectIds("proj-a\n proj-b \n\nprojectId\nproj-c\n")).toEqual(["proj-a", "proj-b", "proj-c"]);
    expect(parseProjectIds("")).toEqual([]);
    expect(parseProjectIds(null as any)).toEqual([]);
  });

  it("keyAddUrl builds the endpoint + strips trailing slashes", () => {
    expect(keyAddUrl("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000/api/keys/add");
    expect(keyAddUrl("http://x:3000/")).toBe("http://x:3000/api/keys/add");
    expect(keyAddUrl(undefined as any)).toBe("http://127.0.0.1:3000/api/keys/add");
  });

  it("redactKeys masks anything shaped like a Google API key", () => {
    const k = "AIza" + "B".repeat(35);
    expect(redactKeys(`leaked ${k} here`)).toBe("leaked AIza…REDACTED here");
    expect(redactKeys(`err ${k} and ${k}`)).not.toContain(k);
    expect(redactKeys("no secret here")).toBe("no secret here");
  });

  it("summarize counts statuses + never needs key values", () => {
    const out = summarize([
      { project: "a", status: "added" },
      { project: "b", status: "failed", reason: "enable: 403" },
      { project: "c", status: "skipped" },
    ]);
    expect(out).toContain("1 added");
    expect(out).toContain("1 failed");
    expect(out).toContain("1 skipped");
    expect(out).toContain("b: failed (enable: 403)");
  });
});
