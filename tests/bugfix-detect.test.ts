// vC1 P2 — detection harness pure parsers (hermetic, no exec).

import { describe, test, expect } from "vitest";
import { parseTsc, parseVitestLastRun, parseSarif } from "../bugfix/detect";

describe("parseTsc", () => {
  test("parses error lines into findings", () => {
    const out = parseTsc(
      [
        "server/x.ts(12,7): error TS2322: Type 'string' is not assignable to type 'number'.",
        "noise line ignored",
        "server/y.ts(3,1): warning TS6133: 'z' is declared but never used.",
      ].join("\n")
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ source: "tsc", file: "server/x.ts", line: 12, rule: "TS2322", severity: "error" });
    expect(out[1]).toMatchObject({ severity: "warning", rule: "TS6133" });
  });

  test("empty / clean output → no findings", () => {
    expect(parseTsc("")).toEqual([]);
  });
});

describe("parseVitestLastRun", () => {
  test("maps failedTests to error findings", () => {
    const out = parseVitestLastRun({ status: "failed", failedTests: ["tests/a.test.ts > does X"] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: "vitest", severity: "error", rule: "test-fail" });
    expect(out[0].file).toBe("tests/a.test.ts");
  });

  test("no failures → no findings", () => {
    expect(parseVitestLastRun({ status: "passed", failedTests: [] })).toEqual([]);
    expect(parseVitestLastRun({})).toEqual([]);
  });
});

describe("parseSarif", () => {
  const sarif = {
    runs: [
      {
        tool: { driver: { rules: [{ id: "rules.curl-eval", defaultConfiguration: { level: "warning" } }] } },
        results: [
          {
            ruleId: "rules.curl-eval",
            message: { text: "Data is being eval'd from a curl command." },
            locations: [{ physicalLocation: { artifactLocation: { uri: "server/cmd.ts" }, region: { startLine: 41 } } }],
          },
          {
            ruleId: "rules.explicit-error",
            level: "error",
            message: { text: "boom" },
            locations: [{ physicalLocation: { artifactLocation: { uri: "server/z.ts" }, region: { startLine: 7 } } }],
          },
        ],
      },
    ],
  };

  test("extracts ruleId, file, line, message and resolves level", () => {
    const out = parseSarif(sarif);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ source: "semgrep", file: "server/cmd.ts", line: 41, rule: "rules.curl-eval", severity: "warning" });
    expect(out[1]).toMatchObject({ severity: "error", line: 7, rule: "rules.explicit-error" });
  });

  test("empty / malformed sarif → no findings", () => {
    expect(parseSarif({})).toEqual([]);
    expect(parseSarif({ runs: [] })).toEqual([]);
  });
});
