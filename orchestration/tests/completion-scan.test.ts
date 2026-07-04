// completion-scan.test — bin/completion-scan.ts's distinctive census logic. The CLI calls main() at import
// (not importable) and its scan hits the live repo (never spawned here), so these tests pin the PURE
// contract it composes from lib/completion: the grep -rn "file:line:text" → isRealMarkerLine → unique-file
// fold that builds stubFiles, and the proxy-prefix route filtering. Cases are distinct from
// tests/completion.test.ts (which scores bare text lines and the basic prefix drop).
import { describe, it, expect } from "vitest";
import { isRealMarkerLine, filterProxiedMissing } from "../bin/lib/completion";

/** The scanner's fold (completion-scan.ts census): parse grep -rn lines, keep files with ≥1 real marker. */
function markerFiles(grepLines: string[]): string[] {
  const hit = new Set<string>();
  for (const l of grepLines) {
    const m = l.match(/^([^:]+):\d+:(.*)$/);
    if (m && isRealMarkerLine(m[2])) hit.add(m[1]);
  }
  return [...hit];
}

describe("stub census — grep-output lines with real comment markers are kept", () => {
  it("keeps //, #, and HACK/XXX comment markers behind a file:line: prefix", () => {
    expect(markerFiles([
      "server/foo.ts:12:  // TODO wire retry",
      "scripts/build.mjs:3:# FIXME: quoting breaks on macOS",
      "server/legacy.ts:44:  // HACK works around ollama 503",
    ])).toEqual(["server/foo.ts", "scripts/build.mjs", "server/legacy.ts"]);
  });
  it("drops files whose only hit is a string/regex mention of the marker word", () => {
    expect(markerFiles([
      'orchestration/bin/lib/graph.ts:9:const rx = /\\b(TODO|FIXME)\\b/;',
      'scripts/scan.mjs:7:execFileSync("grep", ["-E", "TODO|FIXME", "src"])',
      'server/notes.ts:5:  console.log("XXX placeholder")',
    ])).toEqual([]);
  });
  it("dedupes multi-hit files and ignores malformed grep output", () => {
    expect(markerFiles([
      "server/retry.ts:12:  // TODO wire retry",
      "server/retry.ts:40:  // TODO cap the backoff",
      "grep: scripts/secret: Permission denied",
      "Binary file server/blob matches",
    ])).toEqual(["server/retry.ts"]);
  });
  it("scores JSDoc-star markers real, but quoted mentions inside a comment stay excluded", () => {
    expect(isRealMarkerLine("  * TODO: document the --json flag")).toBe(true);
    expect(isRealMarkerLine('// grep the tree for "TODO" markers')).toBe(false);
  });
});

describe("route census — app.use proxy prefixes drop only true sub-paths (path-segment boundary)", () => {
  it("keeps a sibling route sharing the prefix as a prefix-string but not as a path segment", () => {
    expect(filterProxiedMissing(["/api/ecysearcher-admin", "/api/ecysearcher/deep/sub"], ["/api/ecysearcher"]))
      .toEqual(["/api/ecysearcher-admin"]);
  });
  it("normalizes trailing slashes on both the mount prefix and the call", () => {
    expect(filterProxiedMissing(["/api/proxy"], ["/api/proxy/"])).toEqual([]);
    expect(filterProxiedMissing(["/api/proxy/"], ["/api/proxy"])).toEqual([]);
  });
});
