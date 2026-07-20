// eCym risky() denetimi — GUI otomasyonu körlüğünün testi.
import { describe, test, expect } from "vitest";
import {
  REQUIRED_TOKENS, extractRiskyRegex, hasToken, auditGuard, isGuiRisky, renderGuardReport,
} from "../server/ecym-guard";

/** Canlı ecym'in ÖLÇÜLEN mevcut hâli (2026-07-20) — GUI'ye kör. */
const CURRENT = `
risky(){ printf '%s' "$1" | grep -qiE 'sudo|(^| )rm |dd |mkfs| > |>>|chmod|chown|kill|pkill|curl.*\\|.*sh|wget.*\\|.*sh| mv |shutdown|reboot|launchctl (unload|bootout|disable)|defaults write|>\\s*/'; }
groq_fix(){ echo other; }
`;

const PATCHED = CURRENT.replace(
  "defaults write",
  "defaults write|osascript|tell app|System Events|shortcuts run|automator|tccutil|screencapture|empty trash",
);

describe("extractRiskyRegex — İÇERİK-çıpalı (satır numarasına güvenmez)", () => {
  test("regex çıkarılır", () => {
    const r = extractRiskyRegex(CURRENT);
    expect(r).toContain("sudo");
    expect(r).toContain("chmod");
  });

  test("risky() yoksa null", () => {
    expect(extractRiskyRegex("hicbir sey yok")).toBeNull();
  });

  test("boş/bozuk girdi çökmez", () => {
    expect(extractRiskyRegex("")).toBeNull();
    expect(extractRiskyRegex(null as any)).toBeNull();
  });

  test("fonksiyon başka satıra taşınsa da bulunur", () => {
    const kaydirilmis = "\n\n\n# yorum\n" + CURRENT;
    expect(extractRiskyRegex(kaydirilmis)).toContain("sudo");
  });
});

describe("auditGuard — mevcut liste GUI'ye KÖR", () => {
  test("canlı hâlde gerekli token'ların HEPSİ eksik", () => {
    // Bu testin geçmesi kusurun gerçekliğinin kanıtı: ölçülen ecym'de
    // osascript/tell app/System Events vs. hiçbiri yok.
    const r = auditGuard(CURRENT);
    expect(r.found).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([...REQUIRED_TOKENS]);
    expect(r.present).toEqual([]);
  });

  test("yamalı hâlde denetim TEMİZ", () => {
    const r = auditGuard(PATCHED);
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });

  test("dosya yoksa found=false, ok=false (doğrulanamadı ≠ güvenli)", () => {
    const r = auditGuard(null);
    expect(r.found).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.missing.length).toBe(REQUIRED_TOKENS.length);
  });

  test("kısmi yama kısmi rapor verir", () => {
    const yarim = CURRENT.replace("defaults write", "defaults write|osascript");
    const r = auditGuard(yarim);
    expect(r.present).toContain("osascript");
    expect(r.missing).toContain("tell app");
    expect(r.ok).toBe(false);
  });
});

describe("hasToken", () => {
  test("büyük/küçük harf duyarsız", () => {
    expect(hasToken("…|OSASCRIPT|…", "osascript")).toBe(true);
    expect(hasToken("…|sudo|…", "osascript")).toBe(false);
  });
});

describe("isGuiRisky — ecym'den BAĞIMSIZ ikinci kontrol", () => {
  test("AppleScript yüzeyleri riskli", () => {
    for (const c of [
      `osascript -e 'tell application "Mail" to send'`,
      `osascript -e 'tell app "Finder" to delete'`,
      `shortcuts run "bir sey"`,
      `automator /tmp/x.workflow`,
      `screencapture -x /tmp/a.png`,
      `tccutil reset All`,
    ]) expect(isGuiRisky(c), c).toBe(true);
  });

  test("ARGÜMANLI open -a riskli (uygulamaya veri enjekte eder)", () => {
    expect(isGuiRisky(`open -a "Mail" /tmp/gizli.pdf`)).toBe(true);
    expect(isGuiRisky(`open -a Preview belge.pdf`)).toBe(true);
  });

  test("ARGÜMANSIZ open -a riskli DEĞİL (yalnız uygulamayı açar)", () => {
    expect(isGuiRisky(`open -a "DaVinci Resolve"`)).toBe(false);
    expect(isGuiRisky(`open -a Preview`)).toBe(false);
  });

  test("URL şeması ile açış riskli (dışarı çıkış)", () => {
    expect(isGuiRisky("open https://ornek.com")).toBe(true);
    expect(isGuiRisky("open mailto:biri@ornek.com")).toBe(true);
  });

  test("UYGULAMA ADI tırnak içinde token içerse bile riskli DEĞİL", () => {
    // `open -a "Automator"` uygulamayı AÇAR; `automator x.workflow` iş akışı ÇALIŞTIRIR.
    // Alt-dizi eşleştirmesi ikisini karıştırıyordu — doğrulama harness'i yakaladı.
    expect(isGuiRisky('open -a "Automator"')).toBe(false);
    expect(isGuiRisky('open -a "Script Editor"')).toBe(false);
    expect(isGuiRisky("automator /tmp/x.workflow")).toBe(true);   // komut olarak: riskli
    expect(isGuiRisky("screencapture -x /tmp/a.png")).toBe(true);
  });

  test("zararsız kabuk komutları riskli değil", () => {
    for (const c of ["lsappinfo info -only name", "mdfind -name rapor", "system_profiler SPHardwareDataType"]) {
      expect(isGuiRisky(c), c).toBe(false);
    }
  });

  test("boş girdi çökmez", () => {
    expect(isGuiRisky("")).toBe(false);
    expect(isGuiRisky(null as any)).toBe(false);
  });
});

describe("renderGuardReport", () => {
  test("eksik varsa yamayı SÖYLER ama otomatik çalıştırmaz", () => {
    const out = renderGuardReport(auditGuard(CURRENT));
    expect(out).toContain("EKSİK");
    expect(out).toContain("ecym-risky.patch.sh");
    expect(out).toContain("otomatik çalışmaz");
  });

  test("temizse kısa onay", () => {
    expect(renderGuardReport(auditGuard(PATCHED))).toContain("TAMAM");
  });

  test("dosya yoksa doğrulanamadığını söyler", () => {
    expect(renderGuardReport(auditGuard(null))).toContain("DOĞRULANAMADI");
  });
});
