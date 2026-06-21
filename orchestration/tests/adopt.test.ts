import { describe, it, expect } from "vitest";
import { classifyLicense, isCopyleft, decisionAllowed, normalizeId } from "../bin/lib/licenses";
import { parseAdoptionRows, classifyCell, gate } from "../bin/adopt";

describe("classifyLicense", () => {
  it("permissive / copyleft / weak / unknown", () => {
    expect(classifyLicense("MIT").category).toBe("permissive");
    expect(classifyLicense("Apache-2.0").category).toBe("permissive");
    expect(classifyLicense("GPL-3.0-only").category).toBe("copyleft");
    expect(classifyLicense("AGPL-3.0").category).toBe("copyleft");
    expect(classifyLicense("LGPL-3.0").category).toBe("weak-copyleft");
    expect(classifyLicense("Foobar-9000").category).toBe("unknown");
  });
  it("native/own/public-domain işaretleri permissive", () => {
    expect(classifyLicense("system").category).toBe("permissive");
    expect(classifyLicense("Public domain").category).toBe("permissive");
    expect(classifyLicense("own").allowCopy).toBe(true);
  });
  it("normalizeId -only/-or-later/+ ekini atar", () => {
    expect(normalizeId("GPL-3.0-or-later")).toBe("GPL-3.0");
    expect(normalizeId("Apache-2.0+")).toBe("APACHE-2.0");
  });
});

describe("isCopyleft", () => {
  it("GPL/AGPL/LGPL/MPL → true", () => {
    for (const t of ["GPL-2.0", "AGPL-3.0", "LGPL-2.1", "MPL-2.0", "SSPL-1.0"]) expect(isCopyleft(t)).toBe(true);
  });
  it("MIT/Apache/BSD → false", () => {
    for (const t of ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC"]) expect(isCopyleft(t)).toBe(false);
  });
});

describe("decisionAllowed (lisans-disiplini)", () => {
  it("copyleft + ADOPT → İHLAL", () => {
    expect(decisionAllowed("copyleft", "ADOPT").ok).toBe(false);
  });
  it("copyleft + ref-only → OK", () => {
    expect(decisionAllowed("copyleft", "ref-only").ok).toBe(true);
  });
  it("permissive + ADOPT → OK", () => {
    expect(decisionAllowed("permissive", "ADOPT").ok).toBe(true);
  });
  it("unknown + ADOPT → İHLAL; unknown + idea-only → OK", () => {
    expect(decisionAllowed("unknown", "ADOPT").ok).toBe(false);
    expect(decisionAllowed("unknown", "idea-only").ok).toBe(true);
  });
});

describe("classifyCell — kirli hücreler", () => {
  it("Apache/MIT → permissive; GPL içerirse strictest copyleft", () => {
    expect(classifyCell("Apache/MIT").category).toBe("permissive");
    expect(classifyCell("**GPL-2.0**").category).toBe("copyleft");
    expect(classifyCell("GPL→native API").category).toBe("copyleft");
    expect(classifyCell("MIT (DATA)").category).toBe("permissive");
  });
});

describe("parseAdoptionRows — 2 kolon dialect", () => {
  const VO1 = [
    "| # | Repo | ⭐ | Lisans | Hedef Lane | Ne |",
    "|---|------|-----|--------|-----------|-----|",
    "| 1 | modelcontextprotocol/servers | 87K | Apache/MIT | backend | gateway |",
    "| 10 | gnachman/iTerm2 | 17K | **GPL-2.0** | orchestration | tab — **ref-only** |",
  ].join("\n");
  const VO2 = [
    "| # | Repo / teknik | ⭐ | Lisans | Karar | Ne |",
    "|---|---|-----|--------|-------|-----|",
    "| 1 | native lsof | — | system | **ADOPT** | port→pid |",
    "| 5 | sindresorhus/pid-port | 151 | MIT | eval-only | atlandı |",
  ].join("\n");
  it("vO1 (Hedef Lane, karar not içinde)", () => {
    const rows = parseAdoptionRows(VO1);
    expect(rows.length).toBe(2);
    expect(rows[0].repo).toBe("modelcontextprotocol/servers");
    expect(rows[0].license).toBe("Apache/MIT");
    expect(rows[1].decision).toBe("ref-only");
  });
  it("vO2 (Karar kolonu)", () => {
    const rows = parseAdoptionRows(VO2);
    expect(rows.length).toBe(2);
    expect(rows[0].decision).toBe("ADOPT");
    expect(rows[0].license).toBe("system");
    expect(rows[1].decision).toBe("eval-only");
  });
});

describe("gate — uçtan uca", () => {
  it("GPL+ADOPT → 1 ihlal", () => {
    const md = [
      "| Repo | ⭐ | Lisans | Karar | Ne |",
      "|---|---|---|---|---|",
      "| evil/gpl-lib | 5K | GPL-3.0 | ADOPT | kod kopyala |",
    ].join("\n");
    const vio = gate(parseAdoptionRows(md), "test");
    expect(vio).toHaveLength(1);
    expect(vio[0].repo).toBe("evil/gpl-lib");
  });
  it("temiz matris → 0 ihlal (GPL ref-only, MIT ADOPT, native ADOPT)", () => {
    const md = [
      "| Repo | ⭐ | Lisans | Karar | Ne |",
      "|---|---|---|---|---|",
      "| a/mit | 5K | MIT | ADOPT | ok |",
      "| b/iterm | 17K | GPL-2.0 | ref-only | ok |",
      "| c/native | — | system | ADOPT | ok |",
    ].join("\n");
    expect(gate(parseAdoptionRows(md), "test")).toHaveLength(0);
  });
});
