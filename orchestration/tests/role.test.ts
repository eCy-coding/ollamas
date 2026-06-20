import { describe, it, expect } from "vitest";
import { buildRoleAnswer, type RoleInputs } from "../bin/role";
import { isRoleQuestion, ROLE_QUESTION_RE } from "../bin/role-hook";

const BASE: RoleInputs = {
  mission: "ollamas'ın 8 lane sekmesini read-only izleyen orkestra şefi. Kod yazmaz.",
  current: { ver: "vO6", title: "benchmark agregasyon", status: "done" },
  next: { ver: "vO7", title: "drift-guard otomasyon", status: "planned" },
  planned: [
    { ver: "vO7", title: "drift-guard otomasyon", status: "planned" },
    { ver: "vO8", title: "quality-gate roll-up", status: "planned" },
  ],
  ollamasVersion: "v1.6.0",
  ollamasBranch: "feat/v1.11-roots-abort",
  lanes: [{ branch: "feat/orchestration-v3" }, { branch: "feat/frontend-vf3" }],
  tools: [{ name: "status.ts", gist: "lane durum matrisi" }, { name: "bench.ts", gist: "tok/s agregasyon" }],
};

describe("buildRoleAnswer — canlı durum yansıtır", () => {
  const out = buildRoleAnswer(BASE);
  it("mission + bölümler", () => {
    expect(out).toMatch(/Orkestra Şefi/i);
    expect(out).toMatch(/## Görev/);
    expect(out).toMatch(/## Ne yaparım/);
    expect(out).toMatch(/## Sınır/);
    expect(out).toMatch(/## Mevcut aşama/);
    expect(out).toMatch(/## Geliştirilebilir/);
  });
  it("güncel + sıradaki vO (hardcode değil — girdiden)", () => {
    expect(out).toMatch(/vO6 \(benchmark agregasyon\) DONE/);
    expect(out).toMatch(/vO7 \(drift-guard otomasyon\)/);
  });
  it("ollamas proje aşaması + lane sayısı", () => {
    expect(out).toMatch(/v1\.6\.0/);
    expect(out).toMatch(/feat\/v1\.11-roots-abort/);
    expect(out).toMatch(/lane'ler \(2\)/);
  });
  it("geliştirilebilir aşamalar planned'dan gelir", () => {
    expect(out).toMatch(/- vO8: quality-gate roll-up/);
  });
  it("SELF-UPDATE: girdi değişince çıktı değişir (bayat değil)", () => {
    const evolved = buildRoleAnswer({ ...BASE,
      current: { ver: "vO7", title: "drift-guard", status: "done" },
      next: { ver: "vO8", title: "quality-gate", status: "planned" } });
    expect(evolved).toMatch(/vO7 \(drift-guard\) DONE/);
    expect(evolved).not.toMatch(/vO6 \(benchmark agregasyon\) DONE/);
  });
});

describe("buildRoleAnswer — per-lane canlı aşama tablosu (folded collect sinyali)", () => {
  const out = buildRoleAnswer({ ...BASE, lanes: [
    { branch: "feat/frontend-vf3", done: "vF8 real-time UX", next: "vF9 i18n + theming", dirty: 5 },
    { branch: "feat/cli-v2-clean", done: "v10 self-update", next: "v11 Keychain", dirty: 0 },
  ]});
  it("her lane şu an → geliştirilebilir tablosu", () => {
    expect(out).toMatch(/Şu anki ollamas aşaması \(canlı/);
    expect(out).toContain("frontend-vf3");
    expect(out).toContain("vF8 real-time UX");
    expect(out).toContain("vF9 i18n + theming");
    expect(out).toContain("v11 Keychain");
  });
  it("developable stages = lane NEXT bullets", () => {
    expect(out).toMatch(/Lane bazında geliştirilebilir/);
    expect(out).toMatch(/\*\*frontend-vf3\*\* → vF9 i18n/);
  });
  it("boş done/next → '—' graceful (throw yok)", () => {
    const empty = buildRoleAnswer({ ...BASE, lanes: [{ branch: "feat/tunnel-v1" }] });
    expect(empty).toContain("tunnel-v1");
    expect(empty).toContain("—");
  });
});

describe("buildRoleAnswer — vO6 optimal runtime surface", () => {
  it("optimal VARSA 🏆 0-manuel runtime satırı (model+chip+tok/s)", () => {
    const out = buildRoleAnswer({ ...BASE, optimal: { model: "qwen3-coder:30b", tokS: 119.7, chip: "Apple M4 Max" } });
    expect(out).toMatch(/🏆.*Optimal runtime.*0-manuel/i);
    expect(out).toContain("qwen3-coder:30b");
    expect(out).toContain("119.7");
  });
  it("optimal YOKSA benchprompt-koş fallback (graceful)", () => {
    expect(buildRoleAnswer(BASE)).toMatch(/benchprompt\.ts/);
  });
});

describe("isRoleQuestion — hook matcher", () => {
  it("kimlik/görev sorularını yakalar", () => {
    expect(isRoleQuestion("Bu terminal sekmesinde görevin nedir? Ne yaparsın?")).toBe(true);
    expect(isRoleQuestion("görevin ne")).toBe(true);
    expect(isRoleQuestion("ne yaparsın")).toBe(true);
    expect(isRoleQuestion("bu sekmede görev nedir")).toBe(true);
  });
  it("alakasız prompt'ları reddeder (sessiz)", () => {
    expect(isRoleQuestion("sıradaki versiyonu planla scripts")).toBe(false);
    expect(isRoleQuestion("status.ts çalıştır")).toBe(false);
    expect(isRoleQuestion("")).toBe(false);
  });
  it("regex export edilir", () => {
    expect(ROLE_QUESTION_RE).toBeInstanceOf(RegExp);
  });
});
