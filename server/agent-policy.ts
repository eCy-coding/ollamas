// AJAN İZİN POLİTİKASI — ollamas · eCym · odysseus'un macOS uygulamaları üzerindeki yetkisi.
//
// TASARIM İLKESİ: izinler KOD DEĞİL, VERİDİR. Hangi eylem sınıfının otonom
// çalışacağına Emre panelden karar verir; bu modül yalnız MEKANİZMAYI ve GÜVENLİ
// VARSAYILANI kurar. Bu yüzden hiçbir sınıf varsayılanda "auto" doğmaz — otonomiyi
// açmak operatörün kararıdır, benim varsayılanım değil.
//
// NEDEN GEREKLİ: ekli `~/.local/bin/ecym` içindeki `risky()` reddetme listesi kabuk
// komutları için yazılmış (sudo|rm|dd|chmod|…) ve `osascript` ile `open -a` İÇERMİYOR.
// Oysa AppleScript operatörün adına mail gönderebilir, kişilere mesaj atabilir,
// Finder üzerinden dosya silebilir — ki bu ` rm ` desenine hiç uğramaz. Sınıf-bazlı
// politika bu körlüğü kapatan ikinci katmandır (birincisi risky()'nin genişletilmesi).
//
// FAIL-CLOSED SÖZLEŞMESİ: bilinmeyen sınıf, bilinmeyen değer, bozuk/eksik veri —
// hepsi "deny" üretir. Veri bozulması ASLA yetki genişletmez.

/** Bir uygulama işleminin risk sınıfı. Sıra artan tehlikeye göredir. */
export const RISK_CLASSES = [
  "inspect",              // salt sorgu: lsappinfo, mdfind, system_profiler
  "launch",               // uygulamayı aç (belge/URL argümanı YOK)
  "read",                 // AppleScript okuyucular: sekme listesi, not başlıkları
  "mutate-local",         // yerel değişiklik: not oluştur, belge kaydet, render al
  "communicate-outward",  // dışa iletim: mail, mesaj, paylaşım, satın alma
  "system-change",        // sistem durumu: defaults write, TCC, System Settings
] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];

/** Otonomi seviyesi. ORG_POLICY.json'ın observe<propose<apply-gated merdiveniyle
 *  aynı fikir, uygulama-eylemi bağlamına uyarlanmış. */
export const AUTONOMY_LEVELS = ["deny", "gated", "auto"] as const;
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];

export interface AgentPolicy {
  version: 1;
  updatedAt: number;
  /** Emre'nin panelden işaretlediği sınıf-başı otonomi. */
  classes: Record<RiskClass, Autonomy>;
  /** Uygulama bazlı istisna — sınıf kuralını EZER (genişletebilir de daraltabilir de). */
  apps?: Record<string, Partial<Record<RiskClass, Autonomy>>>;
  /** Emre'nin serbest metin ilkeleri. Brain'e ÖĞRETİLİR, karara girmez —
   *  makine bunları yorumlayıp yetki türetmez, yalnız bilir ve aktarır. */
  principles?: string[];
}

const isRiskClass = (x: unknown): x is RiskClass => RISK_CLASSES.includes(x as RiskClass);
const isAutonomy = (x: unknown): x is Autonomy => AUTONOMY_LEVELS.includes(x as Autonomy);

/**
 * Güvenli varsayılan.
 *
 * Zararsız sınıflar `gated`: kapalı değil (sistem işe yarasın) ama onaysız da değil
 * (operatör ne olduğunu görsün). Değiştiren/ileten/sistem sınıfları `deny`.
 * HİÇBİRİ `auto` değil — otonomiyi Emre açar.
 */
export function defaultPolicy(now = 0): AgentPolicy {
  return {
    version: 1,
    updatedAt: now,
    classes: {
      inspect: "gated",
      launch: "gated",
      read: "gated",
      "mutate-local": "deny",
      "communicate-outward": "deny",
      "system-change": "deny",
    },
  };
}

/**
 * Panelin tek-tık "güvenli preset"i — Emre'nin makul bir tabana hızlı dönüşü.
 *
 * Zararsız sınıflar (inspect/launch/read) `auto` — ajan sormadan inceler/açar/okur.
 * `mutate-local` `gated` (yerel değişiklik onay ister). GERİ-ALINAMAZ sınıflar
 * (communicate-outward/system-change) `deny` — DEĞİŞMEZ: preset asla dışa-iletimi ya da
 * sistem-değişikliğini otonom yapmaz; onları Emre bilerek ve tek tek açmalı.
 */
export function safePreset(): Record<RiskClass, Autonomy> {
  return {
    inspect: "auto",
    launch: "auto",
    read: "auto",
    "mutate-local": "gated",
    "communicate-outward": "deny",
    "system-change": "deny",
  };
}

/**
 * Bir (uygulama, sınıf) çifti için geçerli otonomi.
 *
 * Uygulama istisnası sınıf kuralını ezer. İstisna BOZUKSA sınıf kuralına DÜŞMEZ —
 * `deny` olur: aksi halde veri bozulması yetki genişletirdi.
 */
export function decide(policy: AgentPolicy, app: string, cls: RiskClass): Autonomy {
  if (!policy || typeof policy !== "object") return "deny";
  if (!isRiskClass(cls)) return "deny";

  const apps = policy.apps;
  if (apps && typeof apps === "object") {
    const key = Object.keys(apps).find((k) => k.toLowerCase() === String(app ?? "").toLowerCase());
    if (key) {
      const override = (apps[key] ?? {})[cls];
      // İstisna TANIMLIYSA son sözü odur — geçersizse deny, sınıfa düşmez.
      if (override !== undefined) return isAutonomy(override) ? override : "deny";
    }
  }

  const classes = policy.classes;
  if (!classes || typeof classes !== "object") return "deny";
  const v = classes[cls];
  return isAutonomy(v) ? v : "deny";
}

/**
 * eCym'in `safe` alanına çeviri.
 *
 * `~/.local/bin/ecym:90` şunu yapar: `[ "$SAFE" = "True" ] && ! risky "$CMD"`.
 * Yani YALNIZ tam olarak "True" doğrudan çalışır, kalan her şey onay kapısına düşer.
 * `gated` ve `deny` ikisi de "False" üretir — aradaki fark politika katmanında
 * anlamlıdır (deny hiç önerilmez, gated onayla çalışır), eCym kapısında değil.
 */
export function toSafeField(a: Autonomy): "True" | "False" {
  return a === "auto" ? "True" : "False";
}

export interface PolicyValidation {
  ok: boolean;
  errors: string[];
}

/** Politikanın yapısal geçerliliği. Eksik sınıf = sessiz boşluk = sessiz yetki → red. */
export function validatePolicy(x: unknown): PolicyValidation {
  const errors: string[] = [];
  if (!x || typeof x !== "object" || Array.isArray(x)) {
    return { ok: false, errors: ["politika bir nesne olmalı"] };
  }
  const p = x as Partial<AgentPolicy>;
  if (p.version !== 1) errors.push("version 1 olmalı");
  if (!p.classes || typeof p.classes !== "object") {
    errors.push("classes eksik");
    return { ok: false, errors };
  }
  for (const c of RISK_CLASSES) {
    const v = (p.classes as Record<string, unknown>)[c];
    if (v === undefined) errors.push(`sınıf eksik: ${c}`);
    else if (!isAutonomy(v)) errors.push(`geçersiz otonomi (${c}): ${String(v)}`);
  }
  if (p.apps !== undefined) {
    if (!p.apps || typeof p.apps !== "object" || Array.isArray(p.apps)) errors.push("apps bir nesne olmalı");
    else {
      for (const [app, over] of Object.entries(p.apps)) {
        if (!over || typeof over !== "object") { errors.push(`apps.${app} nesne olmalı`); continue; }
        for (const [c, v] of Object.entries(over)) {
          if (!isRiskClass(c)) errors.push(`apps.${app}: bilinmeyen sınıf ${c}`);
          else if (!isAutonomy(v)) errors.push(`apps.${app}.${c}: geçersiz otonomi ${String(v)}`);
        }
      }
    }
  }
  if (p.principles !== undefined && !Array.isArray(p.principles)) errors.push("principles bir dizi olmalı");
  return { ok: errors.length === 0, errors };
}

/**
 * Panelden gelen KISMİ güncellemeyi tabana uygula.
 *
 * Verilmeyen alan korunur. Geçersiz değer YOK SAYILIR (tabandaki değer kalır) —
 * bozuk bir panel isteği mevcut politikayı bozamaz.
 */
export function mergePolicy(base: AgentPolicy, patch: Partial<AgentPolicy>, now = Date.now()): AgentPolicy {
  const classes = { ...base.classes };
  if (patch.classes && typeof patch.classes === "object") {
    for (const [c, v] of Object.entries(patch.classes)) {
      if (isRiskClass(c) && isAutonomy(v)) classes[c] = v;
    }
  }

  let apps = base.apps;
  if (patch.apps && typeof patch.apps === "object" && !Array.isArray(patch.apps)) {
    apps = { ...(base.apps ?? {}) };
    for (const [app, over] of Object.entries(patch.apps)) {
      if (!over || typeof over !== "object") continue;
      const clean: Partial<Record<RiskClass, Autonomy>> = {};
      for (const [c, v] of Object.entries(over)) if (isRiskClass(c) && isAutonomy(v)) clean[c] = v;
      if (Object.keys(clean).length) apps[app] = { ...(apps[app] ?? {}), ...clean };
      else delete apps[app]; // boş istisna = istisnayı kaldır
    }
  }

  return {
    version: 1,
    updatedAt: now,
    classes,
    ...(apps && Object.keys(apps).length ? { apps } : {}),
    ...(Array.isArray(patch.principles) ? { principles: patch.principles }
      : base.principles ? { principles: base.principles } : {}),
  };
}
