import { describe, it, expect } from "vitest";
import { buildIssueBody, parseRepoSlug, auditBranchName, toBase64, type Finding } from "../server/github";

describe("github — buildIssueBody (pure, severity-sorted)", () => {
  const findings: Finding[] = [
    { file: "a.ts", name: "foo", line: 10, symptom: "null deref", fix: "guard", severity: "LOW" },
    { file: "b.ts", name: "bar", line: 3, symptom: "missing await", fix: "await it", severity: "CRITICAL" },
    { file: "c.ts", line: 7, symptom: "leak", severity: "MEDIUM" },
  ];

  it("sorts severities CRITICAL→LOW and renders file:line + symptom/fix", () => {
    const md = buildIssueBody(findings, { model: "qwen3:8b" });
    expect(md).toContain("3 finding(s)");
    expect(md).toContain("auditor: `qwen3:8b`");
    // CRITICAL section appears before MEDIUM before LOW
    expect(md.indexOf("### CRITICAL")).toBeLessThan(md.indexOf("### MEDIUM"));
    expect(md.indexOf("### MEDIUM")).toBeLessThan(md.indexOf("### LOW"));
    expect(md).toContain("**b.ts:3** (`bar`)");
    expect(md).toContain("symptom: missing await");
    expect(md).toContain("fix: guard");
  });

  it("empty findings → honest 'No findings.'", () => {
    const md = buildIssueBody([]);
    expect(md).toContain("0 finding(s)");
    expect(md).toContain("_No findings._");
  });

  it("unknown/absent severity sorts last under UNSPECIFIED", () => {
    const md = buildIssueBody([{ file: "x.ts", symptom: "?" }, { file: "y.ts", severity: "CRITICAL" }]);
    expect(md.indexOf("### CRITICAL")).toBeLessThan(md.indexOf("### UNSPECIFIED"));
  });
});

describe("github — parseRepoSlug (pure, tolerant)", () => {
  it("parses owner/name", () => {
    expect(parseRepoSlug("acme/widgets")).toEqual({ owner: "acme", repo: "widgets" });
  });
  it("tolerates a full github URL + .git + trailing slash", () => {
    expect(parseRepoSlug("https://github.com/acme/widgets.git/")).toEqual({ owner: "acme", repo: "widgets" });
  });
  it("rejects junk", () => {
    expect(parseRepoSlug("nope")).toBeNull();
    expect(parseRepoSlug("")).toBeNull();
    expect(parseRepoSlug("  ")).toBeNull();
  });
});

describe("github — PR helpers (pure)", () => {
  it("auditBranchName slugifies + namespaces, with optional suffix", () => {
    expect(auditBranchName("my repo!")).toBe("ollamas-audit/my-repo");
    expect(auditBranchName("widgets", "2")).toBe("ollamas-audit/widgets-2");
    expect(auditBranchName("")).toBe("ollamas-audit/audit");
  });
  it("toBase64 round-trips UTF-8", () => {
    const s = "# audit\n- bug: déjà";
    expect(Buffer.from(toBase64(s), "base64").toString("utf8")).toBe(s);
  });
});
