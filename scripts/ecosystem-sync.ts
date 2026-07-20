import { loadAppCards } from "./app-literacy-load";
import { buildAppEcymCommands } from "../server/app-literacy";
import { loadPolicy } from "../server/agent-policy-store";

/** 100 uygulama kartından eCym komutları. `safe` alanı operatörün politikası ile
 *  GUI-risk kontrolünün KESİŞİMİNDEN türetilir — burada elle yazılmaz. */
const appLiteracyCommands = () => buildAppEcymCommands(loadAppCards(), loadPolicy());

// ecosystem-sync — ÇALIŞMA PRENSİBİ: her teach/brain işlemi üç sistemi günceller.
// (1) brain: odysseus CANLI durumu superseding fact olur; (2) eCym: brain-erişim
// komutları terminal-dataset.json'a idempotent iner (yedekli, safe:true, kaynak
// işaretli — ecy-brain dataset-mtime ile otomatik rebuild eder); (3) prensipler:
// docs/BRAIN-ECOSYSTEM.md sözleşmesi. Usage: make ecosystem-sync
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { brainAssertFact } from "../server/brain";

const DS = join(homedir(), "ecy-model", "terminal-dataset.json");

const ECYM_CMDS = [
  ...appLiteracyCommands(),
  { id: "brain-sor", level: "orta", triggers: ["brain'e sor", "hafizaya sor", "beyne sor", "brain soru"],
    cmd: "curl -s -X POST http://127.0.0.1:3000/api/brain/ask -H 'content-type: application/json' -d '{\"question\":\"SORU\"}'",
    arg: "SORU yerine sorunuz", desc: "ollamas brain'e soru sorar, atifli sentezli cevap alir", safe: "True", source: "ollamas-sync" },
  { id: "brain-durum", level: "baslangic", triggers: ["brain durumu", "hafiza durumu", "beyin istatistik"],
    cmd: "curl -s 'http://127.0.0.1:3000/api/brain/overview?recent=5'",
    arg: "yok", desc: "brain istatistik + son kayitlar", safe: "True", source: "ollamas-sync" },
  { id: "brain-panel", level: "baslangic", triggers: ["brain paneli", "beyin paneli ac", "hafiza paneli"],
    cmd: "open http://localhost:3000/brain",
    arg: "yok", desc: "brain gorsel panelini tarayicida acar", safe: "True", source: "ollamas-sync" },
  { id: "brain-ogret", level: "orta", triggers: ["brain ogret", "dataset ogret", "beyne dataset yukle"],
    cmd: "make -C ~/Desktop/ollamas brain-teach",
    arg: "yok", desc: "tum ogretme datasetlerini brain'e idempotent yukler", safe: "True", source: "ollamas-sync" },
  { id: "ody-durum", level: "baslangic", triggers: ["odysseus durumu", "ody calisiyor mu", "odysseus saglik"],
    cmd: "ecy-io odysseus '' health",
    arg: "yok", desc: "odysseus (:7860) saglik kontrolu", safe: "True", source: "ollamas-sync" },
];

async function main() {
  // (1) odysseus live fact — read-only probe, no task side-effects ever.
  let odyState = "unreachable";
  try {
    const r = await fetch("http://127.0.0.1:7860/", { signal: AbortSignal.timeout(3000) });
    odyState = r.ok ? "up" : `http-${r.status}`;
  } catch { /* down/absent */ }
  try {
    await brainAssertFact({ subject: "odysseus", predicate: "status", object: `${odyState} @ ${new Date().toISOString().slice(0, 16)}` });
  } catch { /* embedder queued — nightly */ }

  // (2) eCym dataset: backup → idempotent insert → report (approval principle: marked source).
  let added: string[] = [];
  if (existsSync(DS)) {
    const backup = `${DS}.bak-${Date.now()}`;
    copyFileSync(DS, backup);
    const ds = JSON.parse(readFileSync(DS, "utf8"));
    const ids = new Set(ds.commands.map((c: { id: string }) => c.id));
    for (const c of ECYM_CMDS) {
      if (ids.has(c.id)) continue;
      ds.commands.push(c);
      added.push(c.id);
    }
    if (added.length) writeFileSync(DS, JSON.stringify(ds, null, 1));
    console.log(JSON.stringify({ event: "ecosystem.sync", odysseus: odyState, ecymAdded: added, backup: added.length ? backup : "unchanged" }));
  } else {
    console.log(JSON.stringify({ event: "ecosystem.sync", odysseus: odyState, ecym: "dataset-missing" }));
  }
}
void main();
