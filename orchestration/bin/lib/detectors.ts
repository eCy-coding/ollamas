/**
 * detectors.ts — SAF deterministik teşhis detector'ları (vO4 panel).
 *
 * Her detector ham girdi (dosya içeriği / önceden-hesaplanmış grep sayısı) alır, `Finding[]` döner.
 * FS/grep YOK — onu scan.ts canlı sarmalayıcı yapar, sayıyı buraya verir → test edilebilir, kırılmaz.
 * Detector yalnız `evidence` + ham `finding` üretir (confidence:"detected"); çözüm/ref insan yazar.
 */

export type Severity = "blocker" | "high" | "med" | "low" | "info";
export interface Evidence { path: string; lineHint: string; fact: string; }
export interface Finding {
  targetPath: string;
  severity: Severity;
  finding: string;
  evidence: Evidence[];
}

/** package.json: placeholder ad (react-example/example/template/test) + 0.0.0 sürüm tespiti. */
export function nameVersionMismatch(pkgText: string, path: string): Finding[] {
  let j: Record<string, unknown>;
  try { j = JSON.parse(pkgText); } catch { return []; }
  const out: Finding[] = [];
  const name = typeof j.name === "string" ? j.name : "";
  const version = typeof j.version === "string" ? j.version : "";
  if (/^(react-example|example|template|test|my-app|app)$/i.test(name)) {
    out.push({
      targetPath: path, severity: "low",
      finding: `package.json "name" alanı placeholder ("${name}") — release/yayım kimliğiyle uyumsuz`,
      evidence: [{ path, lineHint: `"name"`, fact: `name="${name}"` }],
    });
  }
  if (version === "0.0.0" || version === "") {
    out.push({
      targetPath: path, severity: "low",
      finding: `package.json version="${version || "(yok)"}" — release-please ile senkron değil`,
      evidence: [{ path, lineHint: `"version"`, fact: `version="${version}"` }],
    });
  }
  return out;
}

/** Boş veya eşik-altı (yalnız başlık/whitespace) dosya — kullanılmayan failure-sink göstergesi. */
export function emptyFile(path: string, content: string, minChars = 40): Finding[] {
  const meaningful = content.replace(/^#.*$/gm, "").replace(/\s+/g, " ").trim();
  if (meaningful.length >= minChars) return [];
  return [{
    targetPath: path, severity: "low",
    finding: `${path} boş/eşik-altı — tanımlı ama kullanılmıyor`,
    evidence: [{ path, lineHint: "1", fact: content.trim() === "" ? "dosya boş (empty)" : `anlamlı içerik ${meaningful.length} char < ${minChars}` }],
  }];
}

/** Hiçbir yerden import edilmeyen dizin (inboundRefs scan.ts'te grep ile hesaplanır). */
export function orphanDir(dir: string, inboundRefs: number): Finding[] {
  if (inboundRefs > 0) return [];
  return [{
    targetPath: dir, severity: "med",
    finding: `${dir} orphan — kaynak ağacında import yok (unused-code §7)`,
    evidence: [{ path: dir, lineHint: "-", fact: `inbound import ref = 0` }],
  }];
}

/** Hiçbir yerden referans verilmeyen artefakt (örn. logSeyir.jsonl üretiliyor ama tüketilmiyor). */
export function unreferencedArtifact(artifact: string, refCount: number): Finding[] {
  if (refCount > 0) return [];
  return [{
    targetPath: artifact, severity: "med",
    finding: `${artifact} referanssız — üretiliyor ama hiçbir tüketici/dashboard okumuyor`,
    evidence: [{ path: artifact, lineHint: "-", fact: `kaynak ref = 0` }],
  }];
}

/** Bağlı (producerHits>0) ama tüketicisi olmayan (consumerHits===0) altyapı: prom-client → dashboard yok. */
export function wiredNoConsumer(dep: string, producerHits: number, consumerHits: number, path: string): Finding[] {
  if (producerHits === 0 || consumerHits > 0) return [];
  return [{
    targetPath: path, severity: "med",
    finding: `${dep} bağlı (${producerHits} kullanım) ama tüketici/dashboard yok — observability boşluğu`,
    evidence: [{ path, lineHint: "-", fact: `${dep} producer=${producerHits}, consumer=0` }],
  }];
}

// ── vO4.1 Panel Coverage Expansion: util'ler + 5-persona detector'ları ─────────

/** Satır sayısı (boş string → 0). */
export function lineCount(s: string): number {
  return s === "" ? 0 : s.split("\n").length;
}

/** Yorum-temizle: blok /*...*​/, satır-başı // ve #, satıriçi // (prose-FP azaltır). */
export function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|#)/.test(l))
    .map((l) => l.replace(/(?<!:)\/\/.*$/, "")) // `://` (URL) koru, gerçek // yorumu sil
    .join("\n");
}

const TEST_PATH = /\.(test|spec)\.|__mocks__|fixtures?\//i;

// — frontend —

/** Choke-point bypass: src/'de apiClient dışı raw fetch/axios (frontend lane choke-point yasağı). */
export function chokepointBypass(path: string, content: string, token = "apiClient"): Finding[] {
  if (TEST_PATH.test(path) || path.toLowerCase().includes(token.toLowerCase())) return [];
  const lines = stripComments(content).split("\n");
  const idx = lines.findIndex((l) => /\bfetch\(|\baxios\b/.test(l));
  if (idx < 0) return [];
  return [{
    targetPath: path, severity: "med",
    finding: `${path} choke-point bypass — raw fetch/axios (apiClient dışı çağrı)`,
    evidence: [{ path, lineHint: String(idx + 1), fact: lines[idx].trim().slice(0, 80) }],
  }];
}

/** Aşırı büyük component dosyası (bakım yükü). */
export function oversizedComponent(path: string, lines: number, threshold = 400): Finding[] {
  if (!/\.(tsx|jsx)$/.test(path) || lines <= threshold) return [];
  return [{
    targetPath: path, severity: "low",
    finding: `${path} oversized component (${lines} satır > ${threshold}) — böl/refactor`,
    evidence: [{ path, lineHint: "-", fact: `${lines} satır` }],
  }];
}

// — fullstack —

/** Seam dosyada `: any` yoğunluğu (tip-güvenliği erozyonu). Oran-tabanlı (ham sayı değil). */
export function anyDensity(path: string, anyCount: number, lines: number, ratio = 0.05, min = 5): Finding[] {
  if (anyCount < min || lines <= 0 || anyCount / lines <= ratio) return [];
  return [{
    targetPath: path, severity: "low",
    finding: `${path} yüksek \`: any\` yoğunluğu (${anyCount}/${lines}) — tip-güvenliği erozyonu`,
    evidence: [{ path, lineHint: "-", fact: `any=${anyCount}, ratio=${(anyCount / lines).toFixed(3)}` }],
  }];
}

// — integrations —

const PLACEHOLDER = /process\.env|\$\{|<your|<YOUR|xxxx|changeme|placeholder|example|dummy|redacted/i;
const SECRET_GENERIC = /(api[_-]?key|token|secret|password|passwd)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/i;
const SECRET_AWS = /\bAKIA[0-9A-Z]{16}\b/;
const SECRET_PRIVKEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/** Gitleaks-stili (MIT, attribution) hardcoded secret tespiti. Placeholder/example/.env.example muaf. */
export function hardcodedSecret(path: string, content: string): Finding[] {
  if (TEST_PATH.test(path) || /\.env\.example$/.test(path)) return [];
  const out: Finding[] = [];
  const lines = content.split("\n");
  lines.forEach((l, i) => {
    if (PLACEHOLDER.test(l)) return;
    const hint = { path, lineHint: String(i + 1), fact: "secret-pattern eşleşti (değer redakte)" };
    if (SECRET_AWS.test(l)) out.push({ targetPath: path, severity: "blocker", finding: `${path} hardcoded AWS access key`, evidence: [hint] });
    else if (SECRET_PRIVKEY.test(l)) out.push({ targetPath: path, severity: "blocker", finding: `${path} hardcoded private key`, evidence: [hint] });
    else if (SECRET_GENERIC.test(l)) out.push({ targetPath: path, severity: "high", finding: `${path} hardcoded credential (api-key/token/secret)`, evidence: [hint] });
  });
  return out;
}

const HTTP_SAFE = /localhost|127\.0\.0\.1|0\.0\.0\.0|w3\.org|xmlns|schemas?\.|example\.(com|org)/i;

/** Şifrelenmemiş http:// URL (loopback/xmlns/schema hariç). */
export function insecureHttp(path: string, content: string): Finding[] {
  if (TEST_PATH.test(path)) return [];
  const lines = stripComments(content).split("\n");
  const idx = lines.findIndex((l) => /http:\/\/[^\s"')]+/.test(l) && !HTTP_SAFE.test(l));
  if (idx < 0) return [];
  return [{
    targetPath: path, severity: "med",
    finding: `${path} şifrelenmemiş http:// isteği (https kullan)`,
    evidence: [{ path, lineHint: String(idx + 1), fact: lines[idx].trim().slice(0, 80) }],
  }];
}

// — macos — (ShellCheck GPL-3.0 → yalnız kural-fikri, kod KOPYALANMADI)

/** Bash/sh shebang'lı script `set -euo pipefail` (veya 3 ayrı flag) eksik → hata-yutma riski. */
export function shellStrictMode(path: string, content: string): Finding[] {
  const first = content.split("\n")[0] || "";
  if (!/^#!.*\b(bash|sh)\b/.test(first)) return [];
  const c = stripComments(content);
  const hasE = /set\s+-\w*e\w*/.test(c);
  const hasU = /set\s+-\w*u\w*/.test(c);
  const hasPipefail = /pipefail/.test(c);
  if (hasE && hasU && hasPipefail) return [];
  return [{
    targetPath: path, severity: "low",
    finding: `${path} 'set -euo pipefail' eksik — sessiz hata-yutma riski`,
    evidence: [{ path, lineHint: "1", fact: `e=${hasE} u=${hasU} pipefail=${hasPipefail}` }],
  }];
}

/** LAN-exposure: script/launchd `0.0.0.0` bind (yorum hariç) — gizlilik riski (RISK-SCR-006). */
export function lanExposure(path: string, content: string): Finding[] {
  const c = stripComments(content);
  const lines = c.split("\n");
  const idx = lines.findIndex((l) => /\b0\.0\.0\.0\b/.test(l));
  if (idx < 0) return [];
  return [{
    targetPath: path, severity: "high",
    finding: `${path} 0.0.0.0 bind — LAN exposure (yalnız 127.0.0.1 + opt-in --lan)`,
    evidence: [{ path, lineHint: String(idx + 1), fact: lines[idx].trim().slice(0, 80) }],
  }];
}

/** Tehlikeli tırnaksız `rm -rf $VAR` (word-split → yanlış silme). Tırnaklı muaf. */
export function unquotedRmVar(path: string, content: string): Finding[] {
  const c = stripComments(content);
  const lines = c.split("\n");
  const idx = lines.findIndex((l) => /\brm\s+-\w*r\w*\s+\$\w+/.test(l));
  if (idx < 0) return [];
  return [{
    targetPath: path, severity: "blocker",
    finding: `${path} tırnaksız 'rm -rf $VAR' — word-split ile yanlış-silme riski`,
    evidence: [{ path, lineHint: String(idx + 1), fact: lines[idx].trim().slice(0, 80) }],
  }];
}

// — mcp —

/** MCP tool def inputSchema var ama outputSchema yok (v1.7 conformance kuralı). */
export function toolMissingOutputSchema(name: string, hasInput: boolean, hasOutput: boolean): Finding[] {
  if (!hasInput || hasOutput) return [];
  return [{
    targetPath: `tool:${name}`, severity: "low",
    finding: `MCP tool '${name}' outputSchema yok (inputSchema var) — conformance eksik`,
    evidence: [{ path: name, lineHint: "-", fact: "inputSchema:true, outputSchema:false" }],
  }];
}

/**
 * Choke-point bypass: tool-registry dışı doğrudan `.execute(`/`.handler(` (ToolRegistry.execute atlanmış).
 * KANONİK `ToolRegistry.execute(...)` çağrısı bypass DEĞİL → muaf (ERR-ORCH-007: detector choke-point'in
 * kendisini bypass sandı; canlı kalibrasyonda yakalandı).
 */
export function chokepointBypassExec(path: string, content: string): Finding[] {
  if (TEST_PATH.test(path) || /tool-registry/i.test(path)) return [];
  const lines = stripComments(content).split("\n");
  const idx = lines.findIndex((l) => /\.execute\(|\.handler\(/.test(l) && !/ToolRegistry\.execute/.test(l));
  if (idx < 0) return [];
  return [{
    targetPath: path, severity: "med",
    finding: `${path} choke-point bypass — ToolRegistry.execute dışı doğrudan execute/handler`,
    evidence: [{ path, lineHint: String(idx + 1), fact: lines[idx].trim().slice(0, 80) }],
  }];
}
