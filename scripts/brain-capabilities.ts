// `make brain-capabilities` — yetenek terfi defteri.
//   (arg yok)          durum tablosu
//   register <id>      yeteneği sandbox olarak kaydet
//   reset <id>         karantinadan sandbox'a (temiz sayfa)
//   quarantine <id>    elle karantinaya al
//   --json             makine-okur
import { loadLedger, saveLedger, ensureCap, ledgerPath } from "../server/brain-capability-runner";
import { renderTable, reset, demote } from "../server/brain-capabilities";

const argv = process.argv.slice(2);
const cmd = argv.find((a) => !a.startsWith("--"));
const id = argv.filter((a) => !a.startsWith("--"))[1];
const asJson = argv.includes("--json");
const ledger = loadLedger();
const now = Date.now();

const need = (): string => {
  if (!id) { console.error(`kullanım: ${cmd} <yetenek-id>`); process.exit(1); }
  if (!ledger.caps[id]) { console.error(`bilinmeyen yetenek: ${id}`); process.exit(1); }
  return id;
};

switch (cmd) {
  case "register":
    if (!id) { console.error("kullanım: register <yetenek-id>"); process.exit(1); }
    ensureCap(ledger, id);
    saveLedger(ledger);
    console.log(`${id} kaydedildi (sandbox) — otonom olmadan önce baraj geçmeli.`);
    break;
  case "reset":
    ledger.caps[need()] = reset(ledger.caps[id!], now);
    saveLedger(ledger);
    console.log(`${id} sandbox'a döndü (geçmiş silindi).`);
    break;
  case "quarantine":
    ledger.caps[need()] = demote(ledger.caps[id!], "elle karantina (CLI)", now);
    saveLedger(ledger);
    console.log(`${id} karantinaya alındı — loop son-iyi yolda devam eder.`);
    break;
  default:
    if (asJson) console.log(JSON.stringify(ledger, null, 2));
    else {
      console.log(`yetenek defteri · ${ledgerPath()}`);
      console.log(renderTable(ledger));
    }
}
