// `make brain-loop-health` — sonsuz loop'un ÖLÇÜLEN durumu.
// "Çalışıyor" demez; yazım oranı, ardışık kuru tur, atlama sınıfları ve süreleri basar.
// --json ile makine-okur çıktı (CI/panel için).
import { homedir } from "node:os";
import { join } from "node:path";
import { readMetrics, summarize, renderHealth } from "../server/brain-loop-health";

const STATE_DIR = process.env.BRAIN_LOOP_DIR || join(homedir(), ".llm-mission-control");
const METRICS_FILE = join(STATE_DIR, "loop-metrics.jsonl");

const limit = Number(process.env.BRAIN_LOOP_HEALTH_N) || 200;
const metrics = readMetrics(METRICS_FILE, limit);
const health = summarize(metrics);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(health, null, 2));
} else if (metrics.length === 0) {
  console.log(`ölçüm yok — ${METRICS_FILE} boş ya da loop hiç koşmadı.`);
  console.log("tek tur için: make brain-loop");
} else {
  console.log(`brain-loop sağlık (son ${metrics.length} tur · ${METRICS_FILE})`);
  console.log(renderHealth(health));
}
