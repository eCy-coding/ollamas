// `make ecym-guard` — eCym'in risky() reddetme listesinde GUI otomasyonu
// token'ları var mı. SALT-OKUNUR: dosyayı okur, raporlar, DEĞİŞTİRMEZ.
//
// ~/.local/bin/ecym deponun DIŞINDA, operatörün kişisel CLI'ı. Yamayı o çalıştırır.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { auditGuard, renderGuardReport } from "../server/ecym-guard";

const p = process.env.ECYM_PATH || join(homedir(), ".local", "bin", "ecym");
const src = existsSync(p) ? readFileSync(p, "utf8") : null;
const report = auditGuard(src);

if (process.argv.includes("--json")) console.log(JSON.stringify({ path: p, ...report }, null, 2));
else { console.log(`kaynak: ${p}`); console.log(renderGuardReport(report)); }

// Uyarı-amaçlı: eksik token build'i DÜŞÜRMEZ (operatörün dosyası, onun kararı).
// Kartların güvenliği isGuiRisky() ile bağımsız olarak zaten sağlanıyor.
process.exit(0);
