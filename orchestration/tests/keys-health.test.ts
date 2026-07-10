// keys-health.test.ts — behavior of keys-health.ts pure render core (glyph + banner + row).
import { describe, it, expect } from "vitest";
import { glyph, formatBanner, formatRow, type ProviderHealth, type Snapshot } from "../bin/lib/keys-health-core";

describe("keys-health/glyph", () => {
  it("maps each status to its glyph, defaulting unknown/absent to ○", () => {
    expect(glyph("live")).toBe("●");
    expect(glyph("cooled")).toBe("◐");
    expect(glyph("invalid")).toBe("✗");
    expect(glyph("absent")).toBe("○");
    expect(glyph("whatever")).toBe("○");
  });
});

describe("keys-health/formatBanner", () => {
  const base: Snapshot = {
    providers: [
      { provider: "openai", status: "live", keyless: false },
      { provider: "groq", status: "cooled", keyless: false },
      { provider: "ollama", status: "live", keyless: true },
    ],
  };
  it("counts live/total and keyless from providers when snap.live is absent", () => {
    expect(formatBanner(base)).toBe("🔑 KEY HEALTH — 2/3 live · 1 keyless (0-manual)");
  });
  it("prefers an explicit snap.live count over recomputing", () => {
    expect(formatBanner({ ...base, live: 5 })).toContain("5/3 live");
  });
  it("appends cloud-cooled and converged flags when set", () => {
    const b = formatBanner({ ...base, allCloudCooled: true, converged: true });
    expect(b).toContain("ALL CLOUD COOLED");
    expect(b).toContain("converged");
  });
  it("handles an empty snapshot without throwing", () => {
    expect(formatBanner({ providers: [] })).toBe("🔑 KEY HEALTH — 0/0 live · 0 keyless (0-manual)");
  });
});

describe("keys-health/formatRow", () => {
  const row = (p: Partial<ProviderHealth>): string =>
    formatRow({ provider: "p", status: "live", keyless: false, ...p });

  it("renders glyph + padded provider + status", () => {
    const r = row({ provider: "openai", status: "live" });
    expect(r.startsWith("  ● openai")).toBe(true);
    expect(r).toMatch(/^ {2}● openai {2,} live$/);   // provider left-padded to a fixed column
  });
  it("annotates keyless, absent (with signup url), and source", () => {
    expect(row({ keyless: true })).toContain("· 0-manual");
    expect(row({ status: "absent", signupUrl: "https://x" })).toContain("needs key (https://x)");
    expect(row({ source: "vault" })).toContain("· vault");
  });
});
