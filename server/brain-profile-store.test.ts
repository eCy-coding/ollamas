// Kişiselleştirme profili kalıcılığı — q* = q + λ·p_u'nun p_u kaynağı (HTTP yolu).
//
// Loop kendi profilini state.profile'da tutar; HTTP route'un eşdeğeri yoktu →
// canlı API'de kişiselleştirme ölüydü. Bu store kullanıcının son-N sorgu vektörünü
// (BASE q, q* DEĞİL — geri-besleme drift'ini önle) atomik+yedekli saklar.
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir = "";
const prev = process.env.BRAIN_LOOP_DIR;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "profstore-")); process.env.BRAIN_LOOP_DIR = dir; });
afterEach(() => {
  if (prev === undefined) delete process.env.BRAIN_LOOP_DIR; else process.env.BRAIN_LOOP_DIR = prev;
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* geçici */ }
});

describe("brain-profile-store", () => {
  test("yaz-oku turu", async () => {
    const { recordQueryVector, loadProfileVectors } = await import("./brain-profile-store");
    recordQueryVector([1, 0, 0]);
    recordQueryVector([0, 1, 0]);
    expect(loadProfileVectors()).toEqual([[1, 0, 0], [0, 1, 0]]);
  });

  test("dosya yok → boş (güvenli)", async () => {
    const { loadProfileVectors } = await import("./brain-profile-store");
    expect(loadProfileVectors()).toEqual([]);
  });

  test("N-tavan: yalnız son N tutulur", async () => {
    const { recordQueryVector, loadProfileVectors } = await import("./brain-profile-store");
    for (let i = 0; i < 30; i++) recordQueryVector([i, 0, 0]);
    const v = loadProfileVectors();
    expect(v.length).toBe(20);              // PROFILE_CAP
    expect(v[0]).toEqual([10, 0, 0]);       // en eski 10 düştü
    expect(v[19]).toEqual([29, 0, 0]);
  });

  test("boyut DEĞİŞİRSE tampon sıfırlanır (embedder değişti → eski vektörler geçersiz)", async () => {
    const { recordQueryVector, loadProfileVectors } = await import("./brain-profile-store");
    recordQueryVector([1, 0, 0]);
    recordQueryVector([2, 0, 0]);
    recordQueryVector([1, 2, 3, 4]);        // farklı boyut
    expect(loadProfileVectors()).toEqual([[1, 2, 3, 4]]); // eskiler atıldı, yalnız yeni boyut
  });

  test("geçersiz vektör (boş / NaN / Infinity) REDDEDİLİR — profil bozulmaz", async () => {
    const { recordQueryVector, loadProfileVectors } = await import("./brain-profile-store");
    recordQueryVector([1, 0, 0]);
    recordQueryVector([]);                  // boş
    recordQueryVector([NaN, 0, 0]);         // NaN
    recordQueryVector([Infinity, 0, 0]);    // Infinity
    expect(loadProfileVectors()).toEqual([[1, 0, 0]]);
  });

  test("bozuk dosya → boş (fail-safe, çökme yok)", async () => {
    const { loadProfileVectors, profilePath } = await import("./brain-profile-store");
    writeFileSync(profilePath(), "{ bozuk");
    expect(loadProfileVectors()).toEqual([]);
  });
});
