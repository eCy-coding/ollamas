import { describe, it, expect } from "vitest";
import {
  parseVersions, currentAndNext, extractNextBlock, extractTodos,
  extractCanonicalPrompt, recentErrors, buildNextDraft, statusOf,
} from "../bin/plan-next";

// ── Dialect fixtures (gerçek lane formatları) ────────────────────────────────

const SCRIPTS = `# ROADMAP_SCRIPTS
## v4 — Adoption ✅
## v5 — Registration Hooks ✅
**Canonical prompt:** scripts v6'yı shellcheck+shfmt ile sertleştir.

**Next precomputed (→v6):** tüm .sh'ı shellcheck ile tara (kuru) + shfmt format + bats-core
ekle (.sh unit test, macOS native).
- [ ] shellcheck tüm .sh
- [ ] shfmt format
- [ ] bats-core unit test

## v6 — Hardening ⬜
`;

const CLI = `# ROADMAP CLI
| Ver | Tema | Durum |
|---|---|---|
| **v6** | Shortcuts | ✅ DONE |
| **v7** | Profiller + secrets | ▶ NEXT |
| **v8** | TUI | |

## v7 — NEXT (önceden-hesaplanmış ilk todo'lar)
1. cli/lib/profiles.ts ekle
2. AES-GCM secrets SecureDB reuse
`;

const FRONTEND = `# FRONTEND_AGENTS §7
| Ver | Ad | Durum | Adoption |
|---|---|---|---|
| **vF5** | Tokens | ✅ DONE | style-dictionary |
| **vF6** | A11y | NEXT | axe-core |
| **vF7** | i18n | — |
`;

const ORCH = `# ROADMAP_ORCHESTRATION
| **vO1** | ✅ DONE | Bootstrap |
| **vO2** | ✅ DONE | Live discovery |
| vO3 | planned | plan-next.ts |
| vO4 | planned | adoption tracker |

## vO2 — Live Discovery (DONE)
**Next precomputed (→vO3):** plan-next.ts <lane> trigger §4 otomasyonu.
`;

describe("statusOf", () => {
  it("done/next/planned ayrımı", () => {
    expect(statusOf("✅ DONE")).toBe("done");
    expect(statusOf("▶ NEXT")).toBe("next");
    expect(statusOf("⬜ planlı")).toBe("planned");
  });
});

describe("parseVersions — 4 dialect", () => {
  it("scripts heading + emoji", () => {
    const vs = parseVersions(SCRIPTS);
    expect(vs.find(v => v.ver === "v5")?.status).toBe("done");
    expect(vs.find(v => v.ver === "v6")?.status).toBe("planned");
  });
  it("cli tablo + text durum", () => {
    const vs = parseVersions(CLI);
    expect(vs.find(v => v.ver === "v6")?.status).toBe("done");
    expect(vs.find(v => v.ver === "v7")?.status).toBe("next");
  });
  it("frontend vF tablo", () => {
    const vs = parseVersions(FRONTEND);
    expect(vs.find(v => v.ver === "vF5")?.status).toBe("done");
    expect(vs.find(v => v.ver === "vF6")?.status).toBe("next");
  });
  it("orchestration vO tablo (ilk-geçiş, detay heading dup atlanır)", () => {
    const vs = parseVersions(ORCH);
    expect(vs.find(v => v.ver === "vO2")?.status).toBe("done");
    expect(vs.find(v => v.ver === "vO3")?.status).toBe("planned");
  });
});

describe("currentAndNext", () => {
  it("scripts: v5 DONE → v6 planned", () => {
    const { current, next } = currentAndNext(parseVersions(SCRIPTS));
    expect(current?.ver).toBe("v5");
    expect(next?.ver).toBe("v6");
  });
  it("cli: v6 DONE → v7 NEXT", () => {
    const { current, next } = currentAndNext(parseVersions(CLI));
    expect(current?.ver).toBe("v6");
    expect(next?.ver).toBe("v7");
  });
  it("orchestration: vO2 DONE → vO3 planned", () => {
    const { current, next } = currentAndNext(parseVersions(ORCH));
    expect(current?.ver).toBe("vO2");
    expect(next?.ver).toBe("vO3");
  });
});

describe("extractNextBlock + extractTodos", () => {
  it("scripts Next precomputed bloğu + 3 todo", () => {
    const b = extractNextBlock(SCRIPTS, "v6");
    expect(b).toMatch(/shellcheck/);
    expect(extractTodos(b)).toHaveLength(3);
  });
  it("cli '## v7 — NEXT' bloğu + numaralı todo", () => {
    const b = extractNextBlock(CLI, "v7");
    expect(extractTodos(b).length).toBeGreaterThanOrEqual(2);
  });
});

describe("extractCanonicalPrompt", () => {
  it("scripts canonical prompt yakalar", () => {
    expect(extractCanonicalPrompt(SCRIPTS)).toMatch(/shellcheck/);
  });
  it("yoksa boş", () => {
    expect(extractCanonicalPrompt(FRONTEND)).toBe("");
  });
});

describe("recentErrors", () => {
  it("son N hata → id+prevention", () => {
    const json = JSON.stringify({ errors: [
      { id: "ERR-X-001", prevention_rule: "kural1" },
      { id: "ERR-X-002", prevention_rule: "kural2" },
    ]});
    expect(recentErrors(json, 5)).toEqual([
      { id: "ERR-X-001", prevention_rule: "kural1" },
      { id: "ERR-X-002", prevention_rule: "kural2" },
    ]);
  });
  it("bozuk/boş JSON → []", () => {
    expect(recentErrors("", 5)).toEqual([]);
    expect(recentErrors("{bad", 5)).toEqual([]);
  });
});

describe("buildNextDraft — uçtan uca", () => {
  it("scripts taslağı spec+prompt+don't-repeat içerir", () => {
    const md = SCRIPTS;
    const vs = parseVersions(md);
    const { current, next } = currentAndNext(vs);
    const nextBlock = extractNextBlock(md, next?.ver);
    const draft = buildNextDraft({
      lane: "scripts", branch: "feat/scripts-v1", wtPath: "/x",
      current, next, nextBlock, todos: extractTodos(nextBlock),
      canonical: extractCanonicalPrompt(md),
      errors: [{ id: "ERR-SCR-001", prevention_rule: "izole worktree kullan" }],
      sources: ["ROADMAP_SCRIPTS.md"], contractFile: "SCRIPTS_AGENTS.md",
    });
    expect(draft).toMatch(/NEXT — scripts lane → v6/);
    expect(draft).toMatch(/## Spec/);
    expect(draft).toMatch(/shellcheck/);
    expect(draft).toMatch(/ERR-SCR-001: izole worktree kullan/);
    expect(draft).toMatch(/\[Context\]/);
    expect(draft).toMatch(/\[Constraints\]/);
    expect(draft).toMatch(/TEKRARLAMA/);
  });
});
