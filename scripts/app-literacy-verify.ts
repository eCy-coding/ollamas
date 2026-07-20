// 100 uygulama kartını TEHLİKELİ OLANI ÇALIŞTIRMADAN doğrula.
//
// Dört kapı: appExists · compile (osacompile, derler ÇALIŞTIRMAZ) · parse · guard.
//
// OSACOMPILE TUZAĞI (ölçüldü): bozuk sözdiziminde bile ÇIKIŞ KODU 0. Hata yalnız
// stderr'de. Naif `exit===0` kontrolü bozuk script'i sessizce geçirirdi.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { validateCards, triggerCollision, buildAppEcymCommands, type AppCard } from "../server/app-literacy";
import { loadPolicy } from "../server/agent-policy-store";
import { isGuiRisky } from "../server/ecym-guard";

const doc = JSON.parse(readFileSync(join(process.cwd(), "data", "app-literacy.json"), "utf8"));
const cards: AppCard[] = doc.cards;

const fails: string[] = [];
const warns: string[] = [];

// 1) Yapı + güvenlik tutarlılığı
const v = validateCards(cards);
fails.push(...v.errors); warns.push(...v.warnings);

// 2) Tetikleyici çakışması — eCym top-1 kosinüs 0.70, mevcut 115 komut
const dsPath = join(homedir(), "ecy-model", "terminal-dataset.json");
const existing = existsSync(dsPath)
  ? (JSON.parse(readFileSync(dsPath, "utf8")).commands ?? []).map((c: any) => ({ id: c.id, triggers: c.triggers ?? [] }))
  : [];
fails.push(...triggerCollision(cards, existing));

// 3) AppleScript sözdizimi — DERLER, çalıştırmaz, TCC istemi tetiklemez
let compiled = 0;
for (const c of cards) for (const op of c.ops) {
  if (op.verify !== "compile") continue;
  const m = op.cmd.match(/osascript\s+-e\s+'([\s\S]+)'/);
  if (!m) { fails.push(`${op.opId}: verify=compile ama osascript -e '…' bulunamadı`); continue; }
  try {
    const out = execFileSync("osacompile", ["-o", "/dev/null", "-e", m[1]],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 });
    // ÇIKIŞ KODUNA GÜVENME: hata stderr'de gelir ve kod yine 0 olur.
    if (/compilation error|syntax error/i.test(String(out))) fails.push(`${op.opId}: derleme hatası`);
    compiled++;
  } catch (e: any) {
    const err = String(e?.stderr ?? e?.message ?? "");
    if (/compilation error|syntax error/i.test(err)) fails.push(`${op.opId}: derleme hatası — ${err.split("\n")[0]}`);
    else warns.push(`${op.opId}: derlenemedi (ortam) — ${err.split("\n")[0].slice(0, 80)}`);
  }
}

// 4) Uygulama var mı
let missing = 0;
for (const c of cards) for (const op of c.ops) {
  if (op.verify !== "appExists") continue;
  try { execFileSync("osascript", ["-e", `id of app "${c.app}"`], { stdio: "ignore", timeout: 10_000 }); }
  catch { warns.push(`${c.app}: kurulu değil (kart bilgi olarak kalır)`); missing++; }
}

// 5) GÜVENLİK KAPISI — safe:"True" olan hiçbir op GUI-riskli olmamalı
const cmds = buildAppEcymCommands(cards, loadPolicy());
for (const cmd of cmds) {
  if (cmd.safe === "True" && isGuiRisky(cmd.cmd)) fails.push(`${cmd.id}: safe=True AMA GUI-riskli — kapı delinmiş`);
}

console.log(`kart ${cards.length} · op ${cmds.length} · derlenen ${compiled} · kurulu-değil ${missing}`);
console.log(`safe=True olan op: ${cmds.filter((c) => c.safe === "True").length} (varsayılan politikada 0 beklenir)`);
if (warns.length) { console.log(`\nuyarı (${warns.length}):`); warns.slice(0, 12).forEach((w) => console.log("  " + w)); }
if (fails.length) { console.error(`\nHATA (${fails.length}):`); fails.slice(0, 20).forEach((f) => console.error("  " + f)); process.exit(1); }
console.log("\ndogrulama TEMİZ");
