// Öğrenilmiş MoE gate'inin (F3b: W_g, b_g) kalıcılığı — TEK yazım noktası.
// Hem canlı HTTP yolu (/api/brain/ask-shared) hem sonsuz loop aynı dosyayı günceller,
// bu yüzden yazım ATOMİK olmalı: iki süreç aynı anda yazarsa yarım JSON kalır ve
// bir sonraki tur gate'i okuyamaz. tmp + rename aynı dosya sisteminde atomiktir.
//
// Ayrıca son-iyi yedek tutulur: bozuk/uyumsuz gate loop'u DÜŞÜRMEZ, sessizce
// son sağlam sürüme dönülür (kusursuz-loop şartı).
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, copyFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Gate { W: number[][]; b: number[] }

const stateDir = (): string => process.env.BRAIN_LOOP_DIR || join(homedir(), ".llm-mission-control");
const gateFile = (): string => join(stateDir(), "gate.json");
const backupFile = (): string => join(stateDir(), "gate.last-good.json");

/** Bir gate'in yapısal olarak sağlam olup olmadığı — NaN/boyut tutarsızlığı sessizce
 *  yayılırsa softmax hepsini NaN yapar ve seçim çöker. */
export function isValidGate(g: unknown): g is Gate {
  if (!g || typeof g !== "object") return false;
  const { W, b } = g as Gate;
  if (!Array.isArray(W) || !Array.isArray(b) || W.length === 0 || W.length !== b.length) return false;
  const dim = W[0]?.length;
  if (!dim) return false;
  return (
    W.every((row) => Array.isArray(row) && row.length === dim && row.every((x) => typeof x === "number" && Number.isFinite(x))) &&
    b.every((x) => typeof x === "number" && Number.isFinite(x))
  );
}

/** Gate'i oku; dosya yok/bozuksa son-iyi yedeğe, o da yoksa null'a düşer. */
export function loadGate(): Gate | null {
  for (const f of [gateFile(), backupFile()]) {
    try {
      if (!existsSync(f)) continue;
      const g = JSON.parse(readFileSync(f, "utf8"));
      if (isValidGate(g)) return g;
    } catch { /* bir sonraki adaya düş */ }
  }
  return null;
}

/** Gate'i ATOMİK yaz (tmp + rename) ve önceki sağlam sürümü yedekle.
 *  Geçersiz gate ASLA diske yazılmaz — bozulmayı kaynağında durdurur. */
export function saveGate(g: Gate): boolean {
  if (!isValidGate(g)) return false;
  const dir = stateDir();
  const target = gateFile();
  const tmp = `${target}.tmp.${process.pid}`;
  try {
    mkdirSync(dir, { recursive: true });
    // Yenisini yazmadan ÖNCE mevcut sağlam sürümü yedekle.
    try { if (existsSync(target)) copyFileSync(target, backupFile()); } catch { /* yedek best-effort */ }
    writeFileSync(tmp, JSON.stringify(g));
    renameSync(tmp, target); // atomik takas
    return true;
  } catch {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* temizlik best-effort */ }
    return false;
  }
}

export const gatePath = gateFile;
