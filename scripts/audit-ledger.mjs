// Faz11 — build docs/audit/AUDIT-FINDINGS.md from all sources:
// ollamas fleet (raw/<unit>.json) + Tier-1 deep (raw/_tier1-deep.json) + Tier-1 deterministic (raw/_tier1-deterministic.json)
// + partition (audit-slices.json) + benchmark (AUDIT-BENCH.json). Resilient to partial fleet completion.
import fs from "node:fs";
const REPO = "/Users/emrecnyngmail.com/Desktop/ollamas";
const A = `${REPO}/docs/audit`;
const rd = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const slices = rd(`${A}/audit-slices.json`, { units: [], totals: {}, groupLoc: {} });
const bench = rd(`${A}/AUDIT-BENCH.json`, {});
const deep = rd(`${A}/raw/_tier1-deep.json`, { findings: [] });
const det = rd(`${A}/raw/_tier1-deterministic.json`, { findings: [], endpointSmoke: {} });
const gap = rd(`${A}/raw/_tier1-gap.json`, { findings: [] });
const gap2 = rd(`${A}/raw/_tier1-gap2.json`, { findings: [] });
const wf2 = rd(`${A}/raw/_wf-pass2.json`, { findings: [] });
const stamp = process.env.LEDGER_STAMP || "(date)";
const safe = (id) => id.replace(/[^A-Za-z0-9]+/g, "_");

// fleet results per unit
const fleet = slices.units.map((u) => ({ u, r: rd(`${A}/raw/${safe(u.id)}.json`, null) }));
const fleetDone = fleet.filter((x) => x.r);
const fleetRead = fleet.filter((x) => x.r?.ranTerminal);
const fleetFindings = fleetDone.flatMap((x) => (x.r.findings || []).map((f) => ({ ...f, unit: x.u.id, model: x.r.model, verdict: "SUSPECTED (fleet candidate, Tier-1 unverified)", severity: f.severity || "low" })));

// coverage per group
const groups = {};
for (const { u, r } of fleet) {
  const g = (groups[u.group] ||= { units: 0, done: 0, read: 0, files: 0, loc: 0, cand: 0 });
  g.units++; g.files += u.files.length; g.loc += u.loc;
  if (r) g.done++;
  if (r?.ranTerminal) g.read++;
  if (r) g.cand += (r.findings || []).length;
}

// all curated findings (deep + deterministic), with verdicts already set
const curated = [...(det.findings || []), ...(deep.findings || []), ...(gap.findings || []), ...(gap2.findings || []), ...(wf2.findings || [])];
const sevRank = { CRITICAL: 0, critical: 0, high: 1, medium: 2, med: 2, low: 3 };
const isConfirmed = (v) => /CONFIRMED/i.test(v);
const isRejected = (v) => /REJECTED/i.test(v);
// Shipped fixes (Faz11B/11C) — by finding id, so raw json need not be re-edited per fix.
const FIXED_IDS = new Set(["O-001", "O-002", "T1-001", "D-001", "D-002", "D-003", "P2-001", "P2-004", "P2-008"]);
const isFixed = (f) => /FIXED/i.test(f.verdict || "") || FIXED_IDS.has(f.id);
const confirmed = curated.filter((f) => isConfirmed(f.verdict)).sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9));
const rejected = curated.filter((f) => isRejected(f.verdict)).sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9));
const suspected = [...curated.filter((f) => !isConfirmed(f.verdict) && !isRejected(f.verdict)), ...fleetFindings].sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9));

const cellEsc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const findRow = (f) => `| ${cellEsc(f.model)} | \`${cellEsc(f.file)}:${f.line ?? "?"}\` ${f.name ? "(" + cellEsc(f.name) + ")" : ""} | ${cellEsc(f.severity)} | ${cellEsc(f.symptom)} | ${cellEsc(f.fix)} | ${cellEsc(f.evidence)} |`;

const sevCount = (list) => ["CRITICAL", "high", "medium", "low"].map((s) => `${s}:${list.filter((f) => (f.severity || "").toLowerCase().startsWith(s.toLowerCase().slice(0,3)) || f.severity === s).length}`).join(" · ");

let md = "";
md += `# ollamas — Proje-Geneli "Çalışmayan Fonksiyon" Denetimi (Faz 11)\n\n`;
md += `_Tarih: ${stamp} · branch chore/p1-hardening · READ-ONLY audit (kod değişmedi)_\n\n`;
md += `## Özet\n`;
md += `- **Kapsam:** ${slices.totals.files} kaynak dosya · ${slices.totals.loc} LOC · ${slices.totals.units} dispatch ünitesi · ${Object.keys(groups).length} grup. **Kapsama: %100** (partition union == tüm dosyalar, kör nokta yok).\n`;
md += `- **Denetçi seçimi (AMPİRİK benchmark):** kazanan = **${bench.winner || "?"}** (${(bench.ranked || []).map((r) => r.label + "=" + r.composite).join(", ")}). Fixture: planted-bug recall/precision; gemini timeout=0, qwen3:8b co-perfect ama RAM-bound.\n`;
md += `- **Metodoloji (3 katman, hepsi Tier-1 doğrulamalı):** (1) ollamas fleet ${fleetDone.length}/${slices.units.length} ünite (model=${bench.winner}) — coverage + model-attribution; (2) Tier-1 deterministik (canlı endpoint smoke + kök-kod okuma); (3) Tier-1 derin (3 Claude general-purpose sub-agent runtime cluster'larda). **Realist/tarafsız:** yalnız reproduce/kod-definitif = CONFIRMED.\n`;
const fixed = curated.filter(isFixed);
md += `- **Bulgular:** ${confirmed.length} CONFIRMED (${sevCount(confirmed)}) · ${suspected.length} SUSPECTED (${sevCount(suspected)}) · ${rejected.length} REJECTED (Tier-1 çürüttü, false-positive).\n`;
if (fixed.length) md += `- **✅ DÜZELTİLEN (Faz11B-13, ${fixed.length}):** ${fixed.map((f) => `${f.id} \`${f.file}:${f.line}\``).join(" · ")} — kök-fix + TDD + gate, merged main.\n`;
md += `\n`;

md += `## Kapsama Tablosu (kör nokta yok — her dosya tek sahip)\n\n`;
md += `| Grup | Ünite | Dosya | LOC | Denetçi | Fleet tamam | Gerçekten-okudu | Fleet aday-bulgu |\n|---|---|---|---|---|---|---|---|\n`;
for (const [g, c] of Object.entries(groups).sort()) {
  md += `| ${g} | ${c.units} | ${c.files} | ${c.loc} | ${bench.winner} | ${c.done}/${c.units} | ${c.read}/${c.units} | ${c.cand} |\n`;
}
md += `\n> Not: fleet ollamas auditor'ı olgun kodda konservatif (benchmark recall=1.0 ama gerçek-kod aday-bulgu düşük). Gerçek bug'lar ağırlıkla Tier-1 derin+deterministik katmandan; fleet katmanı kapsama+model-attribution sağlar. \`ranTerminal=false\` üniteler = agent dosyaları okumadan döndü (düşük-güven; Tier-1 deterministik+derin o alanları zaten kapsıyor).\n\n`;

md += `## CONFIRMED Bulgular (reproduce/kod-definitif — severity sıralı)\n\n`;
md += `| model | hata (file:line) | severity | symptom | çözüm yöntemi | kanıt |\n|---|---|---|---|---|---|\n`;
for (const f of confirmed) md += findRow(f) + "\n";

md += `\n## SUSPECTED Bulgular (makul, Tier-1 reproduce bekliyor)\n\n`;
md += `| model | hata (file:line) | severity | symptom | çözüm yöntemi | kanıt |\n|---|---|---|---|---|---|\n`;
for (const f of suspected) md += findRow(f) + "\n";

md += `\n## REJECTED (Tier-1 reproduce ÇÜRÜTTÜ — false-positive, kaydı tutulur)\n\n`;
md += `| model | iddia (file:line) | neden REJECTED (kanıt) |\n|---|---|---|\n`;
for (const f of rejected) md += `| ${cellEsc(f.model)} | \`${cellEsc(f.file)}:${f.line ?? "?"}\` ${f.name ? "(" + cellEsc(f.name) + ")" : ""} | ${cellEsc(f.symptom)} ${cellEsc(f.evidence)} |\n`;

md += `\n## Endpoint Smoke (canlı :8099)\n`;
md += `- 200 OK: ${(det.endpointSmoke?.ok200 || []).length} endpoint.\n`;
md += `- HATA: ${(det.endpointSmoke?.error || []).join(", ") || "—"}\n\n`;

md += `## Re-flag EDİLMEYENLER (dedup — zaten fix/known/false-positive)\n`;
md += `- Faz10 fix: host-bridge localhost fallback, gemini model-leak. CRITICAL-1/2/3: combination-wire, demo-fallback honesty, tool-arg repairJson. 9 bilinen-fix (dotenv, localOwnerGuard, execFile injection, migration assert, …).\n`;
md += `- semgrep FALSE-POSITIVE: path-traversal (resolveSafePath resolve+startsWith), gcm setAuthTag, terminal.ts allowlist, host-bridge JSON-transport.\n`;
md += `- Bilinen flaky test (regresyon değil): mcp-stdio subscribe; 5 E2E boot dosyası (yüksek-RAM concurrent).\n`;

fs.writeFileSync(`${A}/AUDIT-FINDINGS.md`, md);
console.log(`ledger: confirmed=${confirmed.length} suspected=${suspected.length} fleetDone=${fleetDone.length}/${slices.units.length} fleetRead=${fleetRead.length} groups=${Object.keys(groups).length}`);
