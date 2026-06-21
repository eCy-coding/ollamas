/**
 * doctor.ts (lib) — vO-AUTO.1 readiness denetimi (PURE, deterministik).
 *
 * "0-manuel gerçekten CANLI + TAZE mi?" → bağımsız check listesi (brew/flutter doctor deseni:
 * her check {id,label,status,detail,fix,selfHealable}) → GO/NO-GO verdict + remediation.
 * I/O yok (ham girdi alır) → test edilebilir. CLI doctor.ts dosyaları okuyup besler.
 */

export type Status = "ok" | "warn" | "fail";

export interface Check {
  id: string; label: string; status: Status; detail: string; fix: string; selfHealable: boolean;
}
export interface Verdict { go: boolean; summary: string }

export interface DoctorInput {
  settings: string;                       // .claude/settings.json ham metin
  launchctlOut: string;                   // `launchctl list` çıktısı
  selection: any;                         // MODEL_SELECTION.json parse
  artifacts: Record<string, boolean>;     // dosya var mı (MODEL_PROMPT/CONDUCTOR/AUTOPILOT)
  nowMs: number;                          // şu an (deterministik test için param)
  staleDays: number;
}

const SETUP = "AUTOPILOT_SETUP.md (settings.json hook snippet + autopilot-install.sh load)";

function ageDays(ts: string, nowMs: number): number {
  const t = Date.parse(ts);
  return isFinite(t) ? (nowMs - t) / 86_400_000 : Infinity;
}

/** Bağımsız readiness check'leri (saf). */
export function runChecks(input: DoctorInput): Check[] {
  const { settings, launchctlOut, selection, artifacts, nowMs, staleDays } = input;
  const checks: Check[] = [];

  // (a) Hook-wiring: SessionStart + model-hook .claude/settings.json'da mı (0-manuel-işlem+seçim).
  const hasSession = /SessionStart/.test(settings);
  const hasModelHook = /model-hook/.test(settings);
  checks.push({
    id: "hook-wiring",
    label: "Claude Code hook'ları (SessionStart + model-hook)",
    status: hasSession && hasModelHook ? "ok" : "fail",
    detail: hasSession && hasModelHook ? "aktif" : `eksik: ${!hasSession ? "SessionStart " : ""}${!hasModelHook ? "model-hook" : ""}`.trim(),
    fix: `→ ${SETUP} §1: hook snippet'ini .claude/settings.json'a yapıştır (guardrail: ajan kendi config'ini yazamaz).`,
    selfHealable: false, // privileged/guardrail → kullanıcı
  });

  // (b) launchd autopilot agent yüklü mü (bench-değişimi + periyodik auto).
  const launchdUp = /com\.ollamas\.orchestration\.autopilot/.test(launchctlOut);
  checks.push({
    id: "launchd",
    label: "launchd autopilot agent (WatchPaths + periyodik)",
    status: launchdUp ? "ok" : "warn",
    detail: launchdUp ? "yüklü" : "yüklü değil",
    fix: "→ bash orchestration/bin/autopilot-install.sh load (bir-kerelik, sistem-op).",
    selfHealable: false, // launchctl = privileged sistem-op → kullanıcı
  });

  // (c) Bench tazeliği: stale flag veya ts-yaşı > staleDays (benchmark-best veri kalitesi).
  const ts = selection?.ts || "";
  const age = ageDays(ts, nowMs);
  const stale = selection?.stale === true || age > staleDays;
  checks.push({
    id: "bench-fresh",
    label: "Benchmark verisi tazeliği (en-verimli-seçim girdisi)",
    status: stale ? "warn" : "ok",
    detail: stale ? `bayat (${isFinite(age) ? Math.round(age) : "?"} gün, ts ${ts || "yok"})` : `taze (${ts})`,
    fix: "→ tsx orchestration/bin/doctor.ts --fix (server :3000 açıksa benchprompt --refresh; değilse bench-lane'i koş).",
    selfHealable: true, // benchprompt --refresh ile güvenli tazelenir
  });

  // (d) Otopilot artefaktları üretilmiş mi.
  const missing = Object.entries(artifacts).filter(([, ok]) => !ok).map(([f]) => f);
  checks.push({
    id: "artifacts",
    label: "Otopilot artefaktları (MODEL_PROMPT/CONDUCTOR/AUTOPILOT)",
    status: missing.length ? "warn" : "ok",
    detail: missing.length ? `eksik: ${missing.join(", ")}` : "hepsi var",
    fix: "→ tsx orchestration/bin/autopilot.ts (üret).",
    selfHealable: true,
  });

  return checks;
}

/** fail>0 → NO-GO; yalnız warn → GO-uyarılı; hepsi ok → GO. */
export function verdict(checks: Check[]): Verdict {
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  if (fails > 0) return { go: false, summary: `NO-GO — ${fails} blokaj${warns ? ` + ${warns} uyarı` : ""} (0-manuel AKTİF DEĞİL)` };
  if (warns > 0) return { go: true, summary: `GO (uyarılı) — ${warns} uyarı (aktif ama tazeleme/launchd eksik)` };
  return { go: true, summary: "GO — 0-manuel tam canlı + taze" };
}

const ICON: Record<Status, string> = { ok: "✓", warn: "!", fail: "✗" };
const RANK: Record<Status, number> = { fail: 0, warn: 1, ok: 2 };

/** DOCTOR.md markdown (ranked fail>warn>ok). */
export function renderDoctor(checks: Check[], v: Verdict, ts: string): string {
  const ranked = [...checks].sort((a, b) => RANK[a.status] - RANK[b.status]);
  const rows = ranked.map((c) =>
    `- [${ICON[c.status]}] **${c.label}** — ${c.detail}` + (c.status !== "ok" ? `\n  🔧 ${c.fix}` : ""));
  return [
    `# DOCTOR — 0-manuel autopilot readiness`,
    `<!-- AUTO doctor.ts · ${ts} · ${v.go ? "GO" : "NO-GO"} · regenerate: tsx orchestration/bin/doctor.ts -->`,
    ``,
    `## ${v.go ? "✅" : "🛑"} ${v.summary}`,
    ``,
    ...rows,
    ``,
    `_Doctor read-only denetler + safe self-heal (\`--fix\`); settings.json/launchctl AKTİVASYONU privileged → kullanıcı (${SETUP})._`,
    ``,
  ].join("\n");
}
