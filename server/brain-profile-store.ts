// Kişiselleştirme profili (p_u kaynağı) — HTTP yolunda q* = q + λ·p_u için.
//
// Loop profilini `state.profile`'da tutar; canlı `/api/brain/ask-shared` yolunun
// eşdeğeri YOKTU → API'de kişiselleştirme ölüydü (personalized hep false). Bu store
// kullanıcının son-N BASE sorgu vektörünü kalıcılaştırır. KRİTİK: q* (kişiselleştirilmiş)
// DEĞİL, BASE q saklanır — q* saklamak profili kendi çıktısıyla besleyip λ'yı turdan
// tura büyütürdü (geri-besleme drift'i). agent-policy-store atomik+son-iyi-yedek deseni.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Loop'un profil penceresiyle (state.profile, son 10-20 soru) uyumlu tavan. */
export const PROFILE_CAP = 20;

const stateDir = (): string => process.env.BRAIN_LOOP_DIR || join(homedir(), ".llm-mission-control");
export const profilePath = (): string => join(stateDir(), "brain-profile.json");
const backupPath = (): string => join(stateDir(), "brain-profile.last-good.json");

interface ProfileFile { version: 1; vectors: number[][]; updatedAt: number }

const isFiniteVec = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number" && Number.isFinite(x));

/** Son-N BASE sorgu vektörünü döndür. Yok/bozuk → boş (fail-safe, ASLA çökmez). */
export function loadProfileVectors(): number[][] {
  for (const f of [profilePath(), backupPath()]) {
    try {
      if (!existsSync(f)) continue;
      const p = JSON.parse(readFileSync(f, "utf8")) as ProfileFile;
      if (p && p.version === 1 && Array.isArray(p.vectors) && p.vectors.every(isFiniteVec)) return p.vectors;
    } catch { /* bir sonraki adaya düş */ }
  }
  return [];
}

/**
 * BASE sorgu vektörünü profile ekle (atomik). Geçersiz vektör (boş/NaN/Infinity)
 * REDDEDİLİR. Boyut mevcut tampondan farklıysa (embedder değişimi) tampon SIFIRLANIR —
 * karışık-boyut ortalaması sessizce bozuk p_u üretirdi.
 */
export function recordQueryVector(vec: number[], cap: number = PROFILE_CAP): boolean {
  if (!isFiniteVec(vec)) return false;
  const cur = loadProfileVectors();
  const sameDim = cur.length === 0 || cur[cur.length - 1].length === vec.length;
  const next = (sameDim ? [...cur, vec] : [vec]).slice(-cap);

  const target = profilePath();
  const tmp = `${target}.tmp.${process.pid}`;
  try {
    mkdirSync(stateDir(), { recursive: true });
    try { if (existsSync(target)) copyFileSync(target, backupPath()); } catch { /* yedek best-effort */ }
    writeFileSync(tmp, JSON.stringify({ version: 1, vectors: next, updatedAt: Date.now() } satisfies ProfileFile, null, 1));
    renameSync(tmp, target);
    return true;
  } catch {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* temizlik */ }
    return false;
  }
}
