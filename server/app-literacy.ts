// macOS UYGULAMA OKURYAZARLIĞI — kart şeması + saf eşleyiciler.
//
// Amaç: ollamas · eCym · odysseus bu Mac'teki uygulamaları TANISIN (ne işe yarar,
// neler yapabilir, nasıl sürülür) ve uygun olanları KULLANABİLSİN. Bilgi mevcut
// brain boru hattına, çalıştırılabilir komutlar mevcut eCym boru hattına iner —
// yeni silo yok.
//
// GÜVENLİK SÖZLEŞMESİ: bir op'un çalıştırılabilirliği İKİ bağımsız kapıdan geçer:
//   1) agent-policy.ts — operatörün panelden işaretlediği sınıf otonomisi
//   2) ecym-guard.ts isGuiRisky() — ecym'in kendi listesinden BAĞIMSIZ GUI kontrolü
// İkisinden biri "hayır" derse op `safe:"False"` olur ve onay kapısına düşer.
// Bu yüzden operatör ecym yamasını hiç uygulamasa bile hiçbir kart sessizce
// AppleScript çalıştıramaz.
import { toSafeField, decide, type AgentPolicy, type RiskClass, RISK_CLASSES } from "./agent-policy";
import { isGuiRisky } from "./ecym-guard";

export interface AppOp {
  /** Elle yazılan KARARLI kimlik (`chrome.list-tabs`). ASLA dizi indisinden türetilmez:
   *  kartları yeniden sıralamak brain kayıtlarını çalkalamamalı, eCym'de kopya üretmemeli. */
  opId: string;
  riskClass: RiskClass;
  /** Türkçe tetikleyici ifadeler — eCym her birini AYRI vektör olarak gömer. */
  triggers: string[];
  cmd: string;
  arg: string;
  desc: string;
  level: "baslangic" | "orta" | "ileri";
  /** İlk çalıştırmada macOS'un soracağı izin — kart bunu AÇIKLAR, etrafından dolanmaz. */
  requiresTcc?: "automation" | "screen" | "files";
  verify?: "compile" | "appExists" | "parse" | "none";
}

export interface AppCard {
  rank: number;
  app: string;
  bundleId?: string;
  path?: string;
  scriptable: boolean;
  category: string;
  purpose: string;
  capabilities: string[];
  /** Nasıl sürülür: CLI / AppleScript / Shortcuts / yalnız-GUI. */
  drive: string[];
  ops: AppOp[];
}

export interface TeachRecord {
  id: string;
  content: string;
  actor: string;
  fact?: { subject: string; predicate: string; object: string };
}

export interface EcymCmd {
  id: string;
  level: string;
  triggers: string[];
  cmd: string;
  arg: string;
  desc: string;
  safe: string;
  source: string;
}

/** Kart → brain kayıtları. Her kart bir açıklama, her op bir kullanım kaydı. */
export function buildAppLiteracyRecords(cards: AppCard[]): TeachRecord[] {
  const out: TeachRecord[] = [];
  for (const c of cards) {
    const slug = c.app.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    out.push({
      id: `teach:app:${slug}`,
      actor: "macos",
      content:
        `${c.app} (#${c.rank}, ${c.category}): ${c.purpose} ` +
        `Yapabildikleri: ${c.capabilities.join("; ")}. ` +
        `Nasıl sürülür: ${c.drive.join("; ")}. ` +
        `AppleScript sözlüğü: ${c.scriptable ? "VAR" : "YOK"}.`,
      fact: { subject: c.app, predicate: "kategori", object: c.category },
    });
    for (const op of c.ops) {
      const tcc = op.requiresTcc
        ? ` İlk çalıştırmada macOS "${op.requiresTcc}" izni soracak — kabul etmek operatöre aittir.`
        : "";
      out.push({
        id: `teach:app:${slug}:op:${op.opId.split(".").pop()}`,
        actor: "macos",
        content:
          `${c.app} · ${op.desc} — komut: ${op.cmd} ` +
          `(risk sınıfı: ${op.riskClass}, seviye: ${op.level}).${tcc}`,
      });
    }
  }
  return out;
}

/**
 * Kart → eCym komutları. `safe` alanı İKİ kapının kesişimidir.
 *
 * Politika `auto` dese bile `isGuiRisky` evet diyorsa sonuç "False" olur:
 * operatörün ecym yaması henüz uygulanmamış olabilir ve o boşluğu bir kart
 * doldurmamalı.
 */
export function buildAppEcymCommands(cards: AppCard[], policy: AgentPolicy): EcymCmd[] {
  const out: EcymCmd[] = [];
  for (const c of cards) {
    for (const op of c.ops) {
      const allowed = decide(policy, c.app, op.riskClass);
      const safe = isGuiRisky(op.cmd) ? "False" : toSafeField(allowed);
      out.push({
        id: `app-${op.opId.replace(/\./g, "-")}`,
        level: op.level,
        triggers: op.triggers,
        cmd: op.cmd,
        arg: op.arg,
        desc: op.desc,
        safe,
        source: "app-literacy",
      });
    }
  }
  return out;
}

export interface CardValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** Normalize: tetikleyici çakışma karşılaştırması için. */
const norm = (s: string): string =>
  String(s ?? "").toLowerCase().trim().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "");

/**
 * Tetikleyici çakışması — eCym top-1 kosinüs 0.70 ile eşleşir ve halihazırda
 * 115 komut var. Aynı/çok benzer bir tetikleyici MEVCUT bir komutu sessizce
 * kaçırır: kullanıcı "not al" der, yanlış komut çalışır. Bu yüzden çakışma
 * uyarı değil HATA'dır.
 */
export function triggerCollision(cards: AppCard[], existing: { id: string; triggers: string[] }[]): string[] {
  const taken = new Map<string, string>();
  for (const e of existing) for (const t of e.triggers ?? []) taken.set(norm(t), e.id);

  const errors: string[] = [];
  const seen = new Map<string, string>();
  for (const c of cards) {
    for (const op of c.ops) {
      for (const t of op.triggers) {
        const k = norm(t);
        if (!k) { errors.push(`${op.opId}: boş tetikleyici`); continue; }
        const prior = taken.get(k);
        if (prior) errors.push(`${op.opId}: "${t}" MEVCUT komutla çakışıyor (${prior})`);
        const mine = seen.get(k);
        if (mine) errors.push(`${op.opId}: "${t}" kart içi çakışma (${mine})`);
        seen.set(k, op.opId);
      }
    }
  }
  return errors;
}

/** Yapısal doğrulama — kimlik tekilliği, sınıf geçerliliği, güvenlik tutarlılığı. */
export function validateCards(cards: AppCard[]): CardValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();

  for (const c of cards) {
    if (!c.app) errors.push("app adı boş");
    if (!c.purpose) warnings.push(`${c.app}: purpose boş`);
    if (!Array.isArray(c.ops)) { errors.push(`${c.app}: ops dizi değil`); continue; }
    for (const op of c.ops) {
      if (!op.opId || !/^[a-z0-9-]+\.[a-z0-9-]+$/.test(op.opId)) {
        errors.push(`${c.app}: geçersiz opId "${op.opId}" (biçim: uygulama.eylem)`);
      }
      if (ids.has(op.opId)) errors.push(`yinelenen opId: ${op.opId}`);
      ids.add(op.opId);
      if (!RISK_CLASSES.includes(op.riskClass)) errors.push(`${op.opId}: bilinmeyen risk sınıfı "${op.riskClass}"`);
      if (!op.triggers?.length) errors.push(`${op.opId}: tetikleyici yok (eCym asla eşleştiremez)`);
      if (!op.cmd) errors.push(`${op.opId}: komut boş`);

      // GÜVENLİK TUTARLILIĞI: zararsız sınıf iddia edip GUI otomasyonu çalıştıran op.
      const harmless = op.riskClass === "inspect" || op.riskClass === "launch";
      if (harmless && isGuiRisky(op.cmd)) {
        errors.push(`${op.opId}: "${op.riskClass}" ilan edilmiş ama komut GUI-riskli — sınıfı düzelt`);
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
