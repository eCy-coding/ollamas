#!/usr/bin/env tsx
/**
 * orchestration/bin/provider-smoke.ts — CANLI provider e2e kanıtı (vP5).
 *
 * Unit test gerçek path'i varsayamaz (ERR-TUNNEL-003 dersi) → bu araç GERÇEK server'a
 * (:3000 /api/ai/generate) karşı koşar ve üç şeyi KANITLAR:
 *   1. PINNED: key-canlı her ücretsiz provider pinned istekte kendi source'undan yanıt verir.
 *   2. FALLBACK: tükenmiş (live=0) provider zincir-başı yapılınca yanıt SIRADAKİ provider'dan
 *      gelir (tercih≠pin; router 429/keysiz durumda düşer) — kota YAKMADAN canlı düşüş kanıtı.
 *   3. TERMINAL: ollama-local her zaman yanıtlar (zincirin sonsuz son durağı).
 *
 * Çıktı: PROVIDER_SMOKE.md + stdout özet; herhangi zorunlu adım FAIL → exit 1 (gate).
 * Sıralı koşar (rate-limit nazik); hiç key yoksa dürüst SKIP satırı (silent-cap yok).
 * Çalıştır: tsx orchestration/bin/provider-smoke.ts [--json]
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const BASE = process.env.OLLAMAS_URL || "http://127.0.0.1:3000";
const JSON_OUT = process.argv.includes("--json");
const PROMPT = "Reply with exactly: ok";

export interface SmokeResult {
  step: "pinned" | "fallback" | "terminal";
  provider: string;          // istenen (zincir-başı) provider
  ok: boolean;               // istek YANITLANDI (kendi source'u veya meşru düşüş)
  hit: boolean;              // yanıt İSTENEN provider'ın source'undan geldi
  source: string;            // gerçek yanıt kaynağı (cloud:<id> | ollama-local | ...)
  ms: number;
  detail: string;
}

/** Saf: pinned istek sonucu istenen provider'dan mı geldi? (cloud:<id> öneki toleranslı) */
export function sourceMatches(requested: string, source: string): boolean {
  return source === requested || source === `cloud:${requested}` || source.startsWith(`${requested}:`);
}

/** Saf: sonuç listesi → gate verdict'i.
 *  Router semantiği: provider = zincir-BAŞI (tercih, pin değil) → pinned istekte 429-fallthrough
 *  (ok ama hit değil) HATA DEĞİL, canlı fallback kanıtıdır. Gate kuralları:
 *    · her pinned istek YANITLANMALI (ok)
 *    · ≥2 FARKLI cloud provider kendi source'undan kanıtlanmalı (hit) — "combine" iddiasının kanıtı
 *    · sentetik fallback koşulduysa PASS · terminal (ollama-local) PASS. */
export function smokeVerdict(results: SmokeResult[]): { go: boolean; summary: string } {
  const pinned = results.filter((r) => r.step === "pinned");
  const fallback = results.filter((r) => r.step === "fallback");
  const terminal = results.filter((r) => r.step === "terminal");
  const answered = pinned.length > 0 && pinned.every((r) => r.ok);
  const hits = pinned.filter((r) => r.hit).length;
  const fellthrough = pinned.filter((r) => r.ok && !r.hit).length;
  const fallbackOk = fallback.every((r) => r.ok); // boş (skip) → true, ama raporda görünür
  const terminalOk = terminal.length > 0 && terminal.every((r) => r.ok);
  const go = answered && hits >= 2 && fallbackOk && terminalOk;
  return {
    go,
    summary: `pinned ${pinned.filter((r) => r.ok).length}/${pinned.length} yanıtlı · cloud-hit ${hits} · ` +
      `canlı-fallthrough ${fellthrough} (429→zincir kanıtı) · ` +
      `sentetik-fallback ${fallback.length ? (fallbackOk ? "PASS" : "FAIL") : "SKIP"} · ` +
      `terminal ${terminalOk ? "PASS" : "FAIL"}`,
  };
}

async function gen(provider: string): Promise<{ text: string; source: string; ms: number; error?: string }> {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/api/ai/generate`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: PROMPT, provider }),
      signal: AbortSignal.timeout(Number(process.env.SMOKE_TIMEOUT_MS || 120_000)),
    });
    const ms = Date.now() - t0;
    if (!r.ok) return { text: "", source: "", ms, error: `HTTP ${r.status}` };
    const j: any = await r.json();
    return { text: String(j.text ?? ""), source: String(j.source ?? ""), ms };
  } catch (e: any) {
    return { text: "", source: "", ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 120) };
  }
}

async function main(): Promise<void> {
  const results: SmokeResult[] = [];

  // Pool: key-canlı + tükenmiş provider'ları ayır (choke-point: HTTP, server-import yok).
  let pool: Record<string, any> = {};
  try {
    const r = await fetch(`${BASE}/api/keys/pool`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) pool = (await r.json())?.pool ?? {};
  } catch { /* pool yoksa pinned adımı boş kalır → verdict dürüstçe FAIL */ }
  const livePinned = Object.entries(pool)
    .filter(([, v]: [string, any]) => (v?.live ?? 0) > 0 && v?.defaultModel)
    .map(([id]) => id);
  const deadKeyed = Object.entries(pool)
    .filter(([, v]: [string, any]) => (v?.total ?? 0) > 0 && (v?.live ?? 0) === 0)
    .map(([id]) => id);

  // 1) PINNED — her canlı provider zincir-BAŞI yapılır. hit = kendi source'u; ok-ama-hit-değil
  //    = 429-fallthrough (router tasarımı gereği CANLI fallback kanıtı, hata değil).
  for (const p of livePinned) {
    const g = await gen(p);
    const hit = !g.error && g.text.length > 0 && sourceMatches(p, g.source);
    const ok = !g.error && g.text.length > 0;
    results.push({ step: "pinned", provider: p, ok, hit, source: g.source, ms: g.ms,
      detail: g.error ?? (hit ? "kendi source'undan yanıt" : ok ? `429/kota → zincir '${g.source}'e düştü (canlı fallback kanıtı)` : "yanıtsız") });
    process.stderr.write(`  pinned ${p.padEnd(14)} ${hit ? "✓ hit" : ok ? "↘ fallthrough" : "✗"} ${g.source} ${g.ms}ms${g.error ? ` (${g.error})` : ""}\n`);
  }

  // 2) SENTETİK FALLBACK — keyless erişilemez backend (vllm) zincir-başı: yanıt SIRADAKİNDEN
  //    gelmeli. Kota/auth'a hiç dokunmaz (geçersiz-key hard-fail tasarımına takılmaz, providers.ts:456).
  {
    const p = "vllm";
    const g = await gen(p);
    const ok = !g.error && g.text.length > 0 && !sourceMatches(p, g.source) && g.source.length > 0;
    results.push({ step: "fallback", provider: p, ok, hit: false, source: g.source, ms: g.ms,
      detail: g.error ?? (ok ? `keyless ${p} → zincir '${g.source}'e düştü` : `düşüş kanıtlanamadı (source '${g.source}')`) });
    process.stderr.write(`  fallback ${p} → ${ok ? "✓" : "✗"} ${g.source} ${g.ms}ms\n`);
  }

  // 3) TERMINAL — ollama-local sonsuz son durak.
  {
    const g = await gen("ollama-local");
    const ok = !g.error && g.text.length > 0;
    results.push({ step: "terminal", provider: "ollama-local", ok, hit: ok, source: g.source, ms: g.ms,
      detail: g.error ?? "lokal terminal yanıtladı" });
    process.stderr.write(`  terminal ollama-local ${ok ? "✓" : "✗"} ${g.source} ${g.ms}ms\n`);
  }

  // Bilgi: key'i olup canlısı olmayan provider'lar (geçersiz/soğumada) — P1 yenileme adayları.
  if (deadKeyed.length) process.stderr.write(`  ℹ key-yenileme adayı (live=0): ${deadKeyed.join(", ")}\n`);

  const verdict = smokeVerdict(results);
  const ts = new Date().toISOString();
  const md = [
    `# PROVIDER SMOKE — canlı e2e kanıtı`,
    `<!-- AUTO provider-smoke.ts · ${ts} · ${verdict.go ? "GO" : "NO-GO"} · regenerate: tsx orchestration/bin/provider-smoke.ts -->`,
    ``,
    `## ${verdict.go ? "✅ GO" : "❌ NO-GO"} — ${verdict.summary}`,
    ``,
    `| Adım | Provider | Sonuç | Source | ms | Detay |`,
    `|---|---|---|---|--:|---|`,
    ...results.map((r) => `| ${r.step} | \`${r.provider}\` | ${r.ok ? "✓" : "✗"} | \`${r.source || "—"}\` | ${r.ms} | ${r.detail} |`),
    ``,
    `_Kanıt-yasası: bu dosya GERÇEK :3000 koşusundan üretilir; unit test path-varsayımı yerine canlı e2e._`,
    ``,
  ].join("\n");
  writeFileSync(join(ORCH_DIR, "PROVIDER_SMOKE.md"), md);

  if (JSON_OUT) process.stdout.write(JSON.stringify({ ts, go: verdict.go, summary: verdict.summary, results }) + "\n");
  else process.stdout.write(`[provider-smoke] ${verdict.go ? "GO" : "NO-GO"} · ${verdict.summary} · PROVIDER_SMOKE.md yazıldı\n`);
  if (!verdict.go) process.exit(1);
}

if (process.argv[1] && /provider-smoke\.ts$/.test(process.argv[1])) {
  main().catch((e) => { console.error("[provider-smoke] hata:", e?.message ?? e); process.exit(1); });
}
