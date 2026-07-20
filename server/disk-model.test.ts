// Disk survey saf çekirdeği. Rapor üretir — hiçbir şey silmez.
import { describe, test, expect } from "vitest";
import {
  classifyRisk, rankReclaimable, sizeBuckets, groupByHash, humanBytes,
} from "./disk-model";

describe("classifyRisk", () => {
  test("geri getirilemez olanlar NEVER — büyüklükten önce gelir", () => {
    for (const p of [
      "/Users/x/Library/Keychains/login.keychain",
      "/Users/x/Desktop/proj/.git/objects/pack/pack-abc.pack",
      "/Users/x/.ssh/id_ed25519",
      "/Users/x/Desktop/ollamas/server/brain.ts",
      "/Users/x/.llm-mission-control/brain.db",
      "/Users/x/Pictures/Photos Library.photoslibrary/db",
    ]) expect(classifyRisk(p), p).toBe("never");
  });

  test("yeniden üretilebilirler SAFE", () => {
    for (const p of [
      "/Users/x/proj/node_modules/left-pad/index.js",
      "/Users/x/Library/Caches/foo/bar.bin",
      "/Users/x/Library/Developer/Xcode/DerivedData/App/Build/x.o",
      "/Users/x/Downloads/video.webm.part",
    ]) expect(classifyRisk(p), p).toBe("safe");
  });

  test("bilinmeyen REVIEW (varsayılan ihtiyat)", () => {
    expect(classifyRisk("/Users/x/Documents/rapor.pdf")).toBe("review");
  });

  test("NEVER, SAFE deseniyle çakışsa bile kazanır", () => {
    // ollamas'ın kendi node_modules'u: SAFE deseni eşleşir ama NEVER önce gelir.
    expect(classifyRisk("/Users/x/Desktop/ollamas/node_modules/foo/x.js")).toBe("never");
  });
});

describe("rankReclaimable", () => {
  test("güvenli + büyük önce; never listede kalır ama sonda", () => {
    const r = rankReclaimable([
      { path: "/a/.git/big.pack", bytes: 10_000 },
      { path: "/a/node_modules/x", bytes: 5_000 },
      { path: "/a/Documents/y.pdf", bytes: 8_000 },
    ]);
    expect(r[0].path).toContain("node_modules");
    expect(r.at(-1)!.risk).toBe("never");       // gizlenmedi, sona kondu
    expect(r.at(-1)!.rank).toBe(0);
    expect(r.length).toBe(3);
  });

  test("eski dosya aynı boyutta yeniden önce gelir", () => {
    const now = 1_000 * 86_400_000;
    const r = rankReclaimable([
      { path: "/a/node_modules/yeni", bytes: 1000, mtime: now },
      { path: "/a/node_modules/eski", bytes: 1000, mtime: now - 365 * 86_400_000 },
    ], now);
    expect(r[0].path).toContain("eski");
  });

  test("boş girdi çökmez", () => expect(rankReclaimable([])).toEqual([]));
});

describe("kopya tespiti — İKİ AŞAMALI (hash pahalıdır)", () => {
  test("sizeBuckets yalnız boyutu ÇAKIŞANLARI hash'e aday gösterir", () => {
    const b = sizeBuckets([
      { path: "/a", bytes: 4_000_000_000 },
      { path: "/b", bytes: 4_000_000_000 },   // /a ile aynı boyut → aday
      { path: "/c", bytes: 9_000_000_000 },   // tek → aday değil
    ]);
    expect(b.length).toBe(1);
    expect(b[0].map((x) => x.path).sort()).toEqual(["/a", "/b"]);
  });

  test("küçük dosyalar taranmaz (eşik)", () => {
    expect(sizeBuckets([{ path: "/a", bytes: 10 }, { path: "/b", bytes: 10 }])).toEqual([]);
  });

  test("aynı boyut ≠ aynı içerik: hash karar verir", () => {
    const g = groupByHash([
      { path: "/a", bytes: 100, hash: "H1" },
      { path: "/b", bytes: 100, hash: "H2" },  // boyut aynı, içerik FARKLI
    ]);
    expect(g).toEqual([]); // kopya YOK
  });

  test("gerçek kopya grubu ve geri kazanım hesabı", () => {
    // Canlı örnek: Chrome + .gemini altındaki aynı sürümlü weights.bin (4.0G).
    const g = groupByHash([
      { path: "/chrome/weights.bin", bytes: 4_000_000_000, hash: "H" },
      { path: "/gemini/weights.bin", bytes: 4_000_000_000, hash: "H" },
    ]);
    expect(g.length).toBe(1);
    expect(g[0].paths.length).toBe(2);
    // İkisinden BİRİ kalır → geri kazanım tek dosya kadardır, iki dosya kadar değil.
    expect(g[0].reclaimable).toBe(4_000_000_000);
  });

  test("üç kopya → iki dosya kadar geri kazanım", () => {
    const g = groupByHash([
      { path: "/a", bytes: 1000, hash: "H" },
      { path: "/b", bytes: 1000, hash: "H" },
      { path: "/c", bytes: 1000, hash: "H" },
    ]);
    expect(g[0].reclaimable).toBe(2000);
  });
});

describe("humanBytes", () => {
  test("okunur birim", () => {
    expect(humanBytes(0)).toBe("0B");
    expect(humanBytes(1536)).toBe("1.5K");
    expect(humanBytes(4_000_000_000)).toBe("3.7G");
  });
});
