// synth (pure) — council bulgularını KESİN CEVABA sentezler: "hangi dil → neyi kodla".
//
// Girdi: council Finding[] (LANG/TASK/RISK) + ground-truth dil dosya-sayımı. Çıktı: tema-kümeleri
// (types/tests/errors/security/concurrency/perf/refactor), dil-kararı (sayım + bahsetme), öncelik
// sıralaması (RISK > güvenlik-teması > çok-model-uzlaşısı > sayı). IO-siz → tam unit-test.
//
// Öncelik mantığı (deterministik, AGENTS.md §2.5 CRITICAL-önce):
//   P1 = güvenlik teması VEYA RISK-kind bulgu   (kötü haber ilk sıra)
//   P2 = ≥2 bağımsız model aynı temayı gördü    (debate uzlaşısı = yüksek güven)
//   P3 = tek-model, TASK-kind                    (öneri)

export interface Finding { lane: string; model: string; kind: "LANG" | "TASK" | "RISK"; text: string }
export interface LangCount { lang: string; files: number }

export type Theme = "security" | "tests" | "errors" | "types" | "concurrency" | "perf" | "refactor";

// Tema sınıflandırma (deterministik regex; sıra ÖNEMLİ — güvenlik ilk, refactor son-fallback).
const THEME_RE: [Theme, RegExp][] = [
  ["security", /inject|validat|sanitiz|auth|secret|credential|xss|csrf|vulnerab/i],
  ["concurrency", /race|concurren|synchroniz|mutex|deadlock|queue.*coordinat|shared state/i],
  ["tests", /\btest|coverage|vitest|unit test|e2e|edge case/i],
  ["errors", /error handl|exit code|silent|retry|timeout|logging|fail/i],
  ["types", /type def|type saf|typescript|\.mjs.*\.ts|migrat.*(ts|typescript)|type annotat|isolatedmodules/i],
  ["perf", /optim|latency|performance|lazy load|virtualiz|async|await/i],
  ["refactor", /refactor|restructure|migrat|standardiz|extract|shared util|shared module/i],
];

export function classifyTheme(text: string): Theme {
  for (const [theme, re] of THEME_RE) if (re.test(text)) return theme;
  return "refactor";
}

// Aynı öncelik-bandında tema sıralaması (küçük = daha kritik). Güvenlik lider, refactor catch-all son.
const THEME_SEVERITY: Record<Theme, number> = {
  security: 0, concurrency: 1, errors: 2, tests: 3, types: 4, perf: 5, refactor: 6,
};

export interface ThemeCluster {
  theme: Theme;
  priority: 1 | 2 | 3;
  count: number;         // toplam bulgu
  risks: number;         // RISK-kind (kötü haber)
  models: string[];      // bu temayı gören bağımsız modeller (uzlaşı sinyali)
  lanes: string[];
  samples: string[];     // temsili görev/risk metinleri
}

export interface LangVerdict {
  lang: string;
  files: number;         // ground-truth dosya sayımı
  mentions: number;      // kaç bulguda geçti
  verdict: "primary" | "migrate-source" | "harden" | "specialist" | "minor";
}

export interface CodePlan {
  ts: string;
  totalFindings: number;
  languages: LangVerdict[];   // dil-kararı, öncelik-sıralı
  themes: ThemeCluster[];     // tema-kümeleri, öncelik-sıralı
  headline: string;           // tek-cümle KESİN CEVAP
}

const LANG_ALIASES: [RegExp, string][] = [
  [/typescript|\bts\b|\.ts\b|\.tsx\b|react/i, "TypeScript"],
  [/javascript|\bjs\b|\.mjs\b|\.js\b|es module|node/i, "JavaScript"],
  [/shell|bash|posix|\.sh\b/i, "Shell"],
  [/python|\.py\b/i, "Python"],
  [/\brust\b|\.rs\b/i, "Rust"],
  [/\bgo\b|golang|\.go\b/i, "Go"],
  [/\bsql\b|postgres|sqlite/i, "SQL"],
];

/** Bir LANG-bulgu metninden anılan dilleri çıkar (çoklu). */
export function langsInText(text: string): string[] {
  const out = new Set<string>();
  for (const [re, lang] of LANG_ALIASES) if (re.test(text)) out.add(lang);
  return [...out];
}

/** Dil kararı: ground-truth dosya sayımı + bulgu-bahsi → rol. */
function decideLanguages(findings: Finding[], counts: LangCount[]): LangVerdict[] {
  const mentions: Record<string, number> = {};
  for (const f of findings) for (const l of langsInText(f.text)) mentions[l] = (mentions[l] || 0) + 1;
  const byLang = new Map(counts.map((c) => [c.lang, c.files]));
  const langs = [...new Set([...counts.map((c) => c.lang), ...Object.keys(mentions)])];
  const verdictFor = (lang: string): LangVerdict["verdict"] => {
    if (lang === "TypeScript") return "primary";
    if (lang === "JavaScript") return "migrate-source"; // .mjs → .ts hedefi
    if (lang === "Shell") return "harden";
    if (lang === "Rust" || lang === "Go") return "specialist";
    return "minor";
  };
  return langs
    .map((lang) => {
      const files = byLang.get(lang) ?? 0;
      const ment = mentions[lang] ?? 0;
      return { lang, files, mentions: ment, verdict: verdictFor(lang) };
    })
    .sort((a, b) => {
      const rank = { primary: 0, "migrate-source": 1, harden: 2, specialist: 3, minor: 4 };
      return rank[a.verdict] - rank[b.verdict] || b.files - a.files;
    });
}

/** Ana sentez: bulgu + dil-sayımı → CodePlan. */
export function synthesize(findings: Finding[], counts: LangCount[], ts: string): CodePlan {
  const actionable = findings.filter((f) => f.kind === "TASK" || f.kind === "RISK");
  const byTheme = new Map<Theme, Finding[]>();
  for (const f of actionable) {
    const t = classifyTheme(f.text);
    (byTheme.get(t) ?? byTheme.set(t, []).get(t)!).push(f);
  }
  const clusters: ThemeCluster[] = [...byTheme.entries()].map(([theme, fs]) => {
    const risks = fs.filter((f) => f.kind === "RISK").length;
    const models = [...new Set(fs.map((f) => f.model))];
    const lanes = [...new Set(fs.map((f) => f.lane))];
    const priority: 1 | 2 | 3 = (theme === "security" || risks > 0) ? 1 : (models.length >= 2 ? 2 : 3);
    return { theme, priority, count: fs.length, risks, models, lanes, samples: fs.slice(0, 4).map((f) => f.text) };
  }).sort((a, b) => a.priority - b.priority || THEME_SEVERITY[a.theme] - THEME_SEVERITY[b.theme] || b.count - a.count);

  const languages = decideLanguages(findings, counts);
  const primary = languages.find((l) => l.verdict === "primary")?.lang ?? "TypeScript";
  const topTheme = clusters[0];
  const headline =
    `${primary} birincil dil (${languages.find((l) => l.lang === primary)?.files ?? 0} dosya); ` +
    `en öncelikli iş: ${topTheme ? `${topTheme.theme} (${topTheme.count} bulgu, ${topTheme.lanes.length} lane)` : "yok"}.`;
  return { ts, totalFindings: findings.length, languages, themes: clusters, headline };
}

const THEME_TR: Record<Theme, string> = {
  security: "Güvenlik (input-validation, injection)", tests: "Test coverage (vitest)",
  errors: "Hata yönetimi + exit-code + logging", types: "Tip-güvenliği (.mjs→.ts, tip-defs)",
  concurrency: "Eşzamanlılık (race condition, senkronizasyon)", perf: "Performans (async, lazy-load)",
  refactor: "Refactor / yapısal (shared util, migrasyon)",
};

/** CodePlan → docs/CODE_PLAN.md (KESİN CEVAP, öncelik-sıralı). */
export function renderCodePlan(plan: CodePlan): string {
  const L: string[] = [
    `# CODE_PLAN.md — Hangi dil ile neyi kodlamalı (KESİN CEVAP)`,
    ``,
    `> Oto-üretim: \`tsx orchestration/bin/council.ts --debate\` · ${plan.ts}`,
    `> Kaynak: ${plan.totalFindings} model-bulgu (7 lane) + ground-truth dil-sayımı. Öncelik: güvenlik/risk > çok-model-uzlaşı > öneri.`,
    ``,
    `## TL;DR`,
    `**${plan.headline}**`,
    ``,
    `## 1. Hangi dil (ground-truth dosya-sayımı + karar)`,
    `| Dil | Dosya | Bahsedilme | Karar |`,
    `|-----|-------|-----------|-------|`,
    ...plan.languages.filter((l) => l.files > 0 || l.mentions > 0).map((l) =>
      `| ${l.lang} | ${l.files} | ${l.mentions} | ${langVerdictTr(l.verdict)} |`),
    ``,
    `## 2. Neyi kodla — tema-kümeleri (öncelik-sıralı)`,
    ``,
  ];
  for (const c of plan.themes) {
    L.push(`### P${c.priority} · ${THEME_TR[c.theme]}  ·  ${c.count} bulgu · ${c.lanes.length} lane · ${c.models.length} model uzlaşı${c.risks ? ` · ⚠️ ${c.risks} risk` : ""}`);
    L.push(`- Lane: ${c.lanes.join(", ")}`);
    for (const s of c.samples) L.push(`- ${s}`);
    L.push(``);
  }
  L.push(`> Öncelik motoruyla çapraz: \`tsx orchestration/bin/conduct.ts\` (RED-lane > eksik > bayat).`);
  return L.join("\n");
}

function langVerdictTr(v: LangVerdict["verdict"]): string {
  return { primary: "**BİRİNCİL** — tüm yeni mantık", "migrate-source": "→ TypeScript'e taşı (.mjs)",
    harden: "sağlamlaştır (env-guard, exit-code)", specialist: "uzman/perf — mevcut, yeni-öğrenme yok",
    minor: "ikincil" }[v];
}
