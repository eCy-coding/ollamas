// lane-triage.test.ts — pure-function slice of bin/lane-triage.ts (no git, no fs).
// Covers the cherry-output parser (+/− discrimination), lane selection (pattern + trunk exclusion
// + dedupe), count coercion, ahead-DESC ordering, trunk detection precedence, and table rendering.
import { describe, it, expect } from "vitest";
import {
  parseCherry,
  selectLanes,
  toCount,
  sortRows,
  renderTable,
  detectTrunk,
  type LaneRow,
} from "../bin/lane-triage";

describe("parseCherry", () => {
  it("counts + as unlanded and - as landed", () => {
    const out = "+ 1111111111111111111111111111111111111111\n- 2222222222222222222222222222222222222222\n+ 3333333333333333333333333333333333333333";
    expect(parseCherry(out)).toEqual({ unlanded: 2, landed: 1 });
  });
  it("empty output → zero", () => {
    expect(parseCherry("")).toEqual({ unlanded: 0, landed: 0 });
  });
  it("ignores lines that are neither +/-", () => {
    expect(parseCherry("garbage\n  \n+ abc")).toEqual({ unlanded: 1, landed: 0 });
  });
});

describe("selectLanes", () => {
  const branches = [
    "feat/key-autonomy",
    "feat/orchestra-conductor",
    "fix/audit-cont",
    "chore/p1-hardening",
    "integration/all-lanes",
    "hmc/thing",
    "main",
    "audit/feat/hmc-nodes", // audit/ prefix must NOT match
    "claude/foo",
    "feat/orchestra-conductor", // dup
  ];
  it("keeps only lane-prefixed branches, excludes trunk, dedupes", () => {
    expect(selectLanes(branches, "feat/key-autonomy")).toEqual([
      "feat/orchestra-conductor",
      "fix/audit-cont",
      "chore/p1-hardening",
      "integration/all-lanes",
      "hmc/thing",
    ]);
  });
  it("excludes the given trunk even when it matches the pattern", () => {
    expect(selectLanes(["feat/a", "feat/b"], "feat/a")).toEqual(["feat/b"]);
  });
});

describe("toCount", () => {
  it("parses valid counts", () => expect(toCount("42")).toBe(42));
  it("coerces empty/garbage/negative to 0", () => {
    expect(toCount("")).toBe(0);
    expect(toCount("nope")).toBe(0);
    expect(toCount("-3")).toBe(0);
  });
});

const mk = (lane: string, ahead: number, behind: number): LaneRow => ({
  lane,
  ahead,
  behind,
  unlanded: 0,
  landed: 0,
  age: "1 day ago",
});

describe("sortRows", () => {
  it("orders ahead-DESC, then behind-DESC, then name", () => {
    const rows = [mk("feat/a", 1, 5), mk("feat/z", 26, 1), mk("feat/b", 26, 9), mk("fix/c", 0, 3)];
    expect(sortRows(rows).map((r) => r.lane)).toEqual(["feat/b", "feat/z", "feat/a", "fix/c"]);
  });
  it("does not mutate input", () => {
    const rows = [mk("feat/a", 1, 1), mk("feat/b", 2, 2)];
    const before = rows.map((r) => r.lane);
    sortRows(rows);
    expect(rows.map((r) => r.lane)).toEqual(before);
  });
});

describe("detectTrunk", () => {
  const branches = ["feat/key-autonomy", "main", "feat/x"];
  it("prefers feat/key-autonomy when present", () => {
    expect(detectTrunk(branches, "refs/remotes/origin/main")).toBe("feat/key-autonomy");
  });
  it("falls back to origin/HEAD short name", () => {
    expect(detectTrunk(["main", "feat/x"], "refs/remotes/origin/main")).toBe("main");
  });
  it("falls back to main when nothing resolves", () => {
    expect(detectTrunk(["feat/x"], "")).toBe("main");
  });
});

describe("renderTable", () => {
  const rows = [mk("feat/b", 26, 9), mk("fix/c", 0, 3)];
  const md = renderTable(rows, "feat/key-autonomy", "2026-07-10T00:00:00Z");
  it("emits a header + one row per lane with a TBD disposition", () => {
    expect(md).toContain("| lane | ahead | behind | unlanded(+) | landed(-) | age | disposition |");
    expect(md).toContain("| `feat/b` | 26 | 9 |");
    expect(md.match(/\| TBD \|/g)?.length).toBe(2);
  });
  it("names the trunk and lane count", () => {
    expect(md).toContain("Trunk: `feat/key-autonomy`");
    expect(md).toContain("Lanes: 2");
  });
});
