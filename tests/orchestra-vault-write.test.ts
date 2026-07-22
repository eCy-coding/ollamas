// L41 — obsidian finally writes, and stops searching with the whole sentence.
//
// The role card called obsidian "the only member that can write to the vault" while it had
// never written anything. And it was handed the raw task title as a search query: measured
// live, "e2e kanıt görevi disk doluluk durumu nedir" returned NO hits and burned 135ms — the
// member's whole contribution was dead because of the query, not because the vault was empty.
import { describe, test, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queryFor, fold } from "../server/orchestra-roles";
import { isSafeVaultPath, vaultWrite } from "../server/obsidian-rest";
import { reportPath, reportNote, processTaskBoard } from "../server/orchestra-tasks";

describe("queryFor — a title is a sentence, a query is not", () => {
  test("the measured failure case keeps only the subject", () => {
    const q = queryFor("e2e kanıt görevi disk doluluk durumu nedir");
    expect(q).toBe("disk doluluk");
    expect(q).not.toContain("nedir");
    expect(q).not.toContain("e2e");
    expect(q).not.toContain("gorev");
  });

  test("content words survive, question words do not", () => {
    expect(queryFor("obsidian sync nasıl çalışıyor")).toContain("obsidian");
    expect(queryFor("obsidian sync nasıl çalışıyor")).not.toContain("nasil");
    expect(queryFor("hangi portu kim dinliyor")).not.toContain("hangi");
  });

  test("Turkish folding still applies (İ would otherwise become 'i slem')", () => {
    expect(queryFor("İşlem ağacını göster")).toContain("islem");
    expect(fold("İşlem")).toBe("islem");
  });

  test("a title made entirely of noise still searches for something", () => {
    // Better to search the folded title than to send an empty query.
    expect(queryFor("nedir bu")).toBeTruthy();
    expect(queryFor("")).toBe("");
  });

  test("very short tokens are dropped — they match everything and mean nothing", () => {
    expect(queryFor("bu ve o disk")).toBe("disk");
  });
});

describe("isSafeVaultPath — the path is ours to build, so it fails here", () => {
  test("ordinary vault-relative paths pass", () => {
    expect(isSafeVaultPath("orchestra/reports/2026-07-22-disk.md")).toBe(true);
    expect(isSafeVaultPath("inbox/note.md")).toBe(true);
  });

  test("escapes are refused rather than left for the far end to notice", () => {
    for (const p of [
      "../outside.md", "orchestra/../../etc/passwd", "/etc/passwd", "\\\\server\\share",
      "C:/Windows/x", "", "   ", "a//b", "orchestra/./../x",
    ]) expect(isSafeVaultPath(p), p).toBe(false);
  });

  test("a NUL byte is refused", () => {
    expect(isSafeVaultPath("a\0b.md")).toBe(false);
  });

  test("vaultWrite refuses an unsafe path without any network call", async () => {
    // No credentials configured for this temp vault, so a network attempt would also fail —
    // but the point is that the path check rejects first.
    await expect(vaultWrite("../escape.md", "x", { vault: "/nonexistent" })).resolves.toBe(false);
  });
});

describe("the report obsidian writes", () => {
  test("the path is deterministic — a re-run overwrites instead of accumulating", () => {
    const a = reportPath("disk doluluk durumu nedir", "2026-07-22");
    expect(a).toBe(reportPath("disk doluluk durumu nedir", "2026-07-22"));
    expect(a.startsWith("orchestra/reports/2026-07-22-")).toBe(true);
    expect(isSafeVaultPath(a)).toBe(true);
  });

  test("a title full of punctuation still yields a safe path", () => {
    expect(isSafeVaultPath(reportPath("../../../etc/passwd", "2026-07-22"))).toBe(true);
  });

  test("the report links back rather than duplicating the evidence", () => {
    const n = reportNote("disk doluluk", "Disk %70 dolu", "ecym", "b4edfdfe-disk", "2026-07-22T12:00:00Z");
    expect(n).toContain("Disk %70 dolu");
    expect(n).toContain("[[b4edfdfe-disk]]");
    expect(n).toContain("ecym");
  });
});

describe("report writing inside a task run", () => {
  let vault: string;
  const BOARD = `---\nkanban-plugin: board\n---\n\n## 📥 Backlog\n\n- [ ] disk doluluk durumu nedir\n\n## 🔨 Doing\n\n## ✅ Done\n`;
  const base = {
    runCommand: async () => "Filesystem 926Gi",
    recall: async () => [{ id: "m1", excerpt: "not" }],
    synthesize: async () => ({ answer: "Disk %70 dolu", expert: "ecym", abstained: false }),
  };

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "orch-report-"));
    mkdirSync(join(vault, "orchestra"), { recursive: true });
    writeFileSync(join(vault, "orchestra", "sprint.md"), BOARD);
    process.env.OBSIDIAN_VAULT = "/nonexistent";
  });

  test("a finished task gets a report written by obsidian", async () => {
    const written: { path: string; content: string }[] = [];
    const r = await processTaskBoard(vault, {
      ...base, vaultWrite: async (path, content) => { written.push({ path, content }); return true; },
    });
    expect(r.reported).toBe(1);
    expect(written[0].path).toMatch(/^orchestra\/reports\/\d{4}-\d{2}-\d{2}-/);
    expect(written[0].content).toContain("Disk %70 dolu");
  });

  test("an abstention produces no report — there is nothing to report", async () => {
    const written: string[] = [];
    await processTaskBoard(vault, {
      ...base,
      synthesize: async () => ({ answer: "", expert: "", abstained: true }),
      vaultWrite: async (p) => { written.push(p); return true; },
    });
    expect(written).toEqual([]);
  });

  test("a closed vault skips the report but does not fail the task", async () => {
    const r = await processTaskBoard(vault, {
      ...base, vaultWrite: async () => false,
    });
    expect(r.done).toBe(1);
    expect(r.reported).toBeUndefined();
  });

  test("a throwing vault write is a bonus lost, not a failure mode", async () => {
    const r = await processTaskBoard(vault, {
      ...base, vaultWrite: async () => { throw new Error("REST down"); },
    });
    expect(r.done).toBe(1);
  });
});
