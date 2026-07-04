// siri-shortcut-gen — recipeSiri'den yerel Siri shortcut artefaktlarını (plist + recipe card) üret.
import { recipeSiri, buildWorkflowPlist } from "../cli/lib/shortcuts";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REPO = process.env.OLLAMAS_REPO || join(homedir(), "Desktop", "ollamas");
const dir = join(homedir(), ".ollamas", "shortcuts");
mkdirSync(dir, { recursive: true, mode: 0o700 });

const r = recipeSiri(REPO, "Yelda");
const plistPath = join(dir, "siri.plist");
const cardPath = join(dir, "siri.card.md");
writeFileSync(plistPath, buildWorkflowPlist(r.actions), { mode: 0o600 });

// Bu macOS'ta `shortcuts` CLI import/sign desteklemiyor → elle-kurulum için NET Türkçe kart.
// Shell script'i recipe'den TÜRET (plist ile her zaman senkron — sertleştirme dahil).
const shellScript = String(
  (r.actions.find((a) => a.WFWorkflowActionIdentifier === "is.workflow.actions.runshellscript")
    ?.WFWorkflowActionParameters as any)?.WFShellScript || "",
);
const card = [
  `# "ollamas sor" — Siri yerel arama yardımcısı`,
  ``,
  `Shortcuts.app'te elle 4 adımda kur (bu makinedeki "shortcuts" CLI import/sign desteklemez):`,
  `1. Yeni Shortcut → adını **"ollamas sor"** koy  (Siri bu adı çağırır: "Hey Siri, ollamas sor").`,
  `2. **Ask for Input** ekle → Soru: "Ne sormak istersin?" (Tür: Metin).`,
  `3. **Run Shell Script** ekle:`,
  `     Shell: /bin/bash   ·   Input: Provided Input → "as arguments"`,
  `     Script (aynen — sertleştirilmiş: ORACLE_SOCK + daemon self-ensure):`,
  ...shellScript.split("\n").map((l) => `       ${l}`),
  `4. **Show Result** ekle → 3. adımın çıktısını METİN olarak göster (SES YOK).`,
  ``,
  `Kullanım (YAZIŞMA/sessiz): Shortcut'ı çalıştır (Spotlight/Shortcuts/Type-to-Siri) → soruyu YAZ → yanıt METİN gösterilir.`,
  `Terminal/anında: \`node scripts/siri-chat.mjs\` (REPL) veya \`node scripts/siri-chat.mjs "8 kere 9 eşittir 72"\`.`,
  ``,
  `Çalışma prensibi (siri-ask.mjs, server GEREKMEZ):`,
  `  • Matematik/mantık/sıra/kod → Truth-Oracle deterministik "Doğru/Yanlış" (~250 ms).`,
  `  • Açık uçlu → deep web_search (çok kaynak tam içerik) + qwen3:8b ≤60 kelime Türkçe sentez (+kaynak);`,
  `    yerel model meşgulse kaynak-temelli çıkarımsal yanıta düşer (asla boş kalmaz).`,
  ``,
  `NOT: Run Shell Script minimal PATH kullanır → MUTLAK /opt/homebrew/bin/node şart (script içeriyor).`,
  `plist (referans/otomasyon): ${plistPath}`,
].join("\n");
writeFileSync(cardPath, card, { mode: 0o600 });

console.log("plist:", plistPath);
console.log("card :", cardPath);
console.log("name :", r.name, "(slug:", r.slug + ")");
