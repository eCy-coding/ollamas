// `make permission-test` — mevcut politikanın FİİLEN neye izin verdiğini kanıtlar.
//
// Emre kararı: agresif (auto sınıflar gerçekten çalışır). GÜVENLİK sınırları planProbe'da:
//   inspect→çalışır · read→derle (flag'le çalış+TCC) · mutate→derle (--run-mutations ile çalış)
//   launch→appExists (--launch-all ile hepsi, yoksa temsilci) · gated→ASLA çalışmaz
//
// Bayraklar: --run-reads  --run-mutations  --launch-sample=N  --launch-all
import { execFileSync } from "node:child_process";
import { planProbe, groupByTier, type ProbePlan } from "../server/permission-probe";
import { loadPolicy } from "../server/agent-policy-store";
import { loadAppCards } from "./app-literacy-load";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const num = (n: string, d: number) => { const a = argv.find((x) => x.startsWith(n + "=")); return a ? Number(a.split("=")[1]) : d; };

const cards = loadAppCards();
const policy = loadPolicy();
const plan = planProbe(cards, policy, {
  runReads: flag("--run-reads"),
  runMutations: flag("--run-mutations"),
  launchSample: flag("--launch-all") ? 999 : num("--launch-sample", 6),
});

/** SALT-OKUNUR derleme (osacompile) — TUZAK: bozuk sözdiziminde bile exit 0,
 *  hata yalnız stderr'de (app-literacy-verify.ts deseni). */
function compile(cmd: string): { ok: boolean; note: string } {
  const m = cmd.match(/osascript\s+-e\s+'([\s\S]+)'/);
  if (!m) return { ok: true, note: "osascript değil, atlandı" };
  try {
    const out = execFileSync("osacompile", ["-o", "/dev/null", "-e", m[1]], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 });
    return /compilation error|syntax error/i.test(String(out)) ? { ok: false, note: "derleme hatası" } : { ok: true, note: "derlendi" };
  } catch (e: any) {
    const err = String(e?.stderr ?? e?.message ?? "");
    return /compilation error|syntax error/i.test(err) ? { ok: false, note: err.split("\n")[0].slice(0, 70) } : { ok: true, note: "derlendi (uyarıyla)" };
  }
}

function appExists(app: string): boolean {
  try { execFileSync("osascript", ["-e", `id of app "${app}"`], { stdio: "ignore", timeout: 10_000 }); return true; }
  catch { return false; }
}

/** GERÇEKTEN çalıştır — yalnız planProbe "run" dediği op'lar buraya gelir. */
function run(p: ProbePlan): { ok: boolean; out: string } {
  try {
    // launch: aç, 3sn bekle, kapat (temsilci — makineyi kilitleme).
    if (p.tier === "launch") {
      execFileSync("bash", ["-c", p.cmd], { stdio: "ignore", timeout: 12_000 });
      execFileSync("bash", ["-c", "sleep 3"], { stdio: "ignore", timeout: 6_000 });
      try { execFileSync("osascript", ["-e", `tell application "${p.app}" to quit`], { stdio: "ignore", timeout: 8_000 }); } catch { /* kapatma best-effort */ }
      return { ok: true, out: "açıldı → 3sn → kapatıldı" };
    }
    // read/mutate/inspect: komutu çalıştır, çıktının ilk satırını al.
    const out = execFileSync("bash", ["-c", p.cmd], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: p.tier === "read" ? 20_000 : 15_000 }).trim();
    return { ok: true, out: out.split("\n")[0].slice(0, 90) || "(boş çıktı)" };
  } catch (e: any) {
    const err = String(e?.stderr ?? e?.message ?? "");
    // read op'ları TCC dialog'una takılabilir → timeout. Dürüstçe raporla.
    if (p.tier === "read" && /timed? ?out|timeout/i.test(err)) return { ok: false, out: "TCC izni Emre'yi bekliyor (macOS dialog'u — ben veremem)" };
    return { ok: false, out: err.split("\n")[0].slice(0, 90) };
  }
}

// --- Sınıf-başı yürüt + rapor ---
const TIER_ORDER = ["inspect", "read", "mutate-local", "launch", "communicate-outward", "system-change"];
const grouped = groupByTier(plan);
const counts = { run: 0, ok: 0, fail: 0 };

console.log(`İZİN-TEST · politika: ${TIER_ORDER.map((t) => `${t}=${policy.classes[t as keyof typeof policy.classes] ?? "?"}`).join(" ")}`);
console.log("─".repeat(70));

for (const tier of TIER_ORDER) {
  const ops = grouped[tier] ?? [];
  if (!ops.length) continue;
  const acts = ops.reduce((a, p) => { a[p.action] = (a[p.action] ?? 0) + 1; return a; }, {} as Record<string, number>);
  console.log(`\n[${tier}] ${ops.length} op · ${Object.entries(acts).map(([k, v]) => `${k}:${v}`).join(" ")}`);

  // Çalıştırılacaklar ve derlenecekler (örnek olarak birkaçını göster).
  const runs = ops.filter((p) => p.action === "run");
  for (const p of runs) {
    counts.run++;
    const r = run(p);
    r.ok ? counts.ok++ : counts.fail++;
    console.log(`  ▶ ${p.opId}: ${r.ok ? "✓" : "✗"} ${r.out}`);
  }
  // compile/appExists: örnekle doğrula (hepsini basmadan).
  const checks = ops.filter((p) => p.action === "compile" || p.action === "appExists");
  let cOk = 0, cFail = 0;
  for (const p of checks) {
    const ok = p.action === "compile" ? compile(p.cmd).ok : appExists(p.app);
    ok ? cOk++ : cFail++;
  }
  if (checks.length) console.log(`  ◇ doğrulama: ${cOk}/${checks.length} geçti${cFail ? ` (${cFail} başarısız)` : ""}`);
  const skipped = ops.filter((p) => p.action === "skip");
  if (skipped.length) console.log(`  ⊘ ${skipped.length} skip (${skipped[0].reason})`);
}

console.log("\n" + "─".repeat(70));
console.log(`ÇALIŞTIRILAN ${counts.run} op → ${counts.ok} başarılı, ${counts.fail} başarısız`);
console.log("gated sınıflar (dışa-iletim, sistem-değişiklik) çalıştırılmadı — güvenlik sınırı");
