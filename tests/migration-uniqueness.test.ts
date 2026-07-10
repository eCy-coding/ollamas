// M-012 (GAP-011) — migration version uniqueness invariant. A typo'd duplicate version
// silently SKIPS on an existing DB (version already recorded in schema_migrations) yet runs
// twice on a fresh DB → divergent schema. migrations.ts asserts uniqueness at module load;
// this test locks that invariant in via the extracted assertUniqueVersions() so a future
// refactor cannot quietly drop the guard.
import { describe, test, expect } from "vitest";
import { MIGRATIONS, assertUniqueVersions } from "../server/store/migrations";

describe("M-012 migration version uniqueness", () => {
  test("the real MIGRATIONS array has unique versions (no throw)", () => {
    expect(() => assertUniqueVersions(MIGRATIONS)).not.toThrow();
  });

  test("a duplicate version throws 'Duplicate migration version'", () => {
    const dup = [
      { version: 1, name: "a" },
      { version: 2, name: "b" },
      { version: 1, name: "c" }, // dup of version 1
    ];
    expect(() => assertUniqueVersions(dup)).toThrow(/Duplicate migration version 1/);
  });

  test("names the offending migration in the error", () => {
    const dup = [
      { version: 7, name: "first" },
      { version: 7, name: "second" },
    ];
    expect(() => assertUniqueVersions(dup)).toThrow(/second/);
  });

  test("MIGRATIONS versions are 1..6 contiguous (no accidental renumber)", () => {
    const versions = MIGRATIONS.map((m) => m.version).sort((a, b) => a - b);
    expect(versions).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
