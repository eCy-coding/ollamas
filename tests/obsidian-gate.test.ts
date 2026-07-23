// Mandatory SOFT Obsidian gate — pure unit coverage for server/obsidian-gate.ts.
// deriveOperation/slugify/opNotePath/opNoteBody are plain functions (no IO); obsidianGate is
// the only IO shell, and it's exercised here against mocked server/obsidian-rest.ts +
// server/orchestra-roles.ts so the SOFT-never-throws contract is provable without a live vault.
import { describe, test, expect, vi, beforeEach } from "vitest";
import { isSafeVaultPath } from "../server/obsidian-rest";
import {
  deriveOperation, slugify, opNotePath, opNoteBody, obsidianGate,
  type GatedOperation,
} from "../server/obsidian-gate";
import type { VaultFinding } from "../server/orchestra-roles";

vi.mock("../server/obsidian-rest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/obsidian-rest")>();
  return { ...actual, vaultWrite: vi.fn() };
});
vi.mock("../server/orchestra-roles", () => ({
  obsidianContribute: vi.fn(),
}));

import { vaultWrite } from "../server/obsidian-rest";
import { obsidianContribute } from "../server/orchestra-roles";

const mockedVaultWrite = vaultWrite as unknown as ReturnType<typeof vi.fn>;
const mockedContribute = obsidianContribute as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedVaultWrite.mockReset();
  mockedContribute.mockReset();
});

describe("deriveOperation", () => {
  test.each([
    ["/api/generate", "llm"],
    ["/api/ai/generate", "llm"],
    ["/api/agent/chat", "llm"],
    ["/api/pipeline", "llm"],
    ["/v1/chat/completions", "llm"],
    ["/api/brain/ask", "llm"],
    ["/api/brain/ask-shared", "llm"],
    ["/api/terminal", "terminal"],
    ["/api/workspace/file", "file"],
    ["/api/workspace/upload", "file"],
    ["/api/workspace/download", "file"],
  ] as const)("%s → kind %s", (route, kind) => {
    const op = deriveOperation("POST", route, {});
    expect(op).not.toBeNull();
    expect(op!.kind).toBe(kind);
  });

  test("non-operation routes return null", () => {
    expect(deriveOperation("GET", "/api/keys/pool", {})).toBeNull();
    expect(deriveOperation("GET", "/api/health", {})).toBeNull();
    expect(deriveOperation("GET", "/api/security/log", {})).toBeNull();
  });

  test("llm summary prefers prompt, falls back to last message content, then question", () => {
    expect(deriveOperation("POST", "/api/generate", { prompt: "merhaba dünya" })!.summary).toBe("merhaba dünya");
    expect(
      deriveOperation("POST", "/v1/chat/completions", {
        messages: [{ role: "user", content: "first" }, { role: "assistant", content: "reply" }, { role: "user", content: "second" }],
      })!.summary,
    ).toBe("second");
    expect(deriveOperation("POST", "/api/brain/ask", { question: "ne durumdayız" })!.summary).toBe("ne durumdayız");
    expect(deriveOperation("POST", "/api/generate", {})!.summary).toBe("llm operation");
  });

  test("terminal summary is the command, file summary is the relativePath/path", () => {
    expect(deriveOperation("POST", "/api/terminal", { command: "git status" })!.summary).toBe("git status");
    expect(deriveOperation("POST", "/api/terminal", {})!.summary).toBe("terminal operation");
    expect(deriveOperation("POST", "/api/workspace/file", { relativePath: "notes/a.md" })!.summary).toBe("notes/a.md");
    expect(deriveOperation("GET", "/api/workspace/download", { path: "b.txt" })!.summary).toBe("b.txt");
    expect(deriveOperation("POST", "/api/workspace/upload", {})!.summary).toBe("file operation");
  });
});

describe("slugify", () => {
  test("lowercases, replaces non-alnum, collapses, trims, caps length", () => {
    expect(slugify("Merhaba Dünya!!")).toBe("merhaba-d-nya");
    expect(slugify("  leading/trailing  ")).toBe("leading-trailing");
    expect(slugify("")).toBe("op");
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(40);
  });
});

describe("opNotePath", () => {
  const op: GatedOperation = { kind: "llm", summary: "merhaba dünya" };

  test("is date-bucketed from nowIso, not wall-clock time", () => {
    const p = opNotePath(op, "2026-07-23T14:05:09.000Z");
    expect(p).toMatch(/^journal\/ops\/2026-07-23\/140509-llm-.+\.md$/);
  });

  test("is always isSafeVaultPath-safe", () => {
    expect(isSafeVaultPath(opNotePath(op, "2026-01-01T00:00:00.000Z"))).toBe(true);
    expect(isSafeVaultPath(opNotePath({ kind: "file", summary: "../../etc/passwd" }, "2026-01-01T00:00:00.000Z"))).toBe(true);
  });
});

describe("opNoteBody", () => {
  const op: GatedOperation = { kind: "terminal", summary: "git status" };
  const nowIso = "2026-07-23T00:00:00.000Z";

  test("contains frontmatter, kind, and the summary", () => {
    const body = opNoteBody(op, [], nowIso);
    expect(body).toContain("tags: [ops, terminal]");
    expect(body).toContain("kind: terminal");
    expect(body).toContain("git status");
    expect(body).toContain("## Recalled");
  });

  test("embeds a [[wikilink]] per finding when findings are present", () => {
    const findings: VaultFinding[] = [
      { path: "journal/notes/a.md", score: 0.9, excerpt: "some recalled excerpt", backlinks: [], tags: [] },
    ];
    const body = opNoteBody(op, findings, nowIso);
    expect(body).toContain("[[journal/notes/a.md]]");
    expect(body).toContain("some recalled excerpt");
  });

  test("has an empty-state line when there are no findings", () => {
    const body = opNoteBody(op, [], nowIso);
    expect(body).toMatch(/no matching notes found/);
  });
});

describe("obsidianGate (IO shell, SOFT, never throws)", () => {
  const op: GatedOperation = { kind: "llm", summary: "test question" };
  const nowIso = "2026-07-23T10:00:00.000Z";

  test("returns touched:false + reason when both read and write fail (offline)", async () => {
    mockedContribute.mockResolvedValue({ ok: false, findings: [], reason: "offline" });
    mockedVaultWrite.mockResolvedValue(false);
    const result = await obsidianGate(op, nowIso);
    expect(result.touched).toBe(false);
    expect(result.reason).toBe("offline");
    expect(result.findings).toEqual([]);
  });

  test("returns touched:true when vaultWrite succeeds even if read failed", async () => {
    mockedContribute.mockResolvedValue({ ok: false, findings: [], reason: "offline" });
    mockedVaultWrite.mockResolvedValue(true);
    const result = await obsidianGate(op, nowIso);
    expect(result.touched).toBe(true);
    expect(result.notePath).toBeDefined();
  });

  test("never throws even if the mocked helpers reject", async () => {
    mockedContribute.mockRejectedValue(new Error("boom"));
    mockedVaultWrite.mockResolvedValue(false);
    await expect(obsidianGate(op, nowIso)).resolves.toMatchObject({ touched: false });
  });
});
