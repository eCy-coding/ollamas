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
