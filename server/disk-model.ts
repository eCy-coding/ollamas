// Disk survey'inin SAF çekirdeği — sınıflandırma, sıralama, kopya eşleştirme.
// IO yok: scripts/disk-survey.ts dosya sistemine dokunan ince kabuktur.
//
// KAPSAM (Emre kararı, 2026-07-20): disk %91'den %69'a düştü (274Gi boş), aciliyet
// bitti. Bu modül YALNIZ raporlar. Sıkıştırma şeridi ve kuarantina scripti bilinçli
// olarak YAZILMADI — 274Gi boşken gereksiz karmaşıklık.
//
// SİLME ASLA OTONOM DEĞİL: burası bir rapor üretir, `rm` kararı operatöründür.

export type Risk = "safe" | "review" | "never";

export interface FileItem {
  path: string;
  bytes: number;
  /** Son değişiklik (epoch ms) — eskilik sıralamayı etkiler. */
  mtime?: number;
}

/** ASLA dokunulmayacak yollar. Bir şeyin geri getirilemez olması, büyük olmasından
 *  daha önemlidir — şüphede "never" tarafına düşülür. */
const NEVER = [
  /\/Library\/Keychains\//,
  /\/\.git\//,
  /\/\.ssh\//,
  /\/Desktop\/ollamas\//,
  /\.llm-mission-control\/brain\.db/,
  /Photos Library\.photoslibrary/,
  /\/\.Trash\/.*\/\.Trash\//, // iç içe çöp: dokunma
  /\/System\//,
  /\/\.docker\/|\/\.gnupg\//,
];

/** Yeniden üretilebilir olduğu için silinmesi güvenli sayılanlar. */
const SAFE = [
  /\/node_modules\//,
  /\/Library\/Caches\//,
  /\/\.npm\/_cacache\//,
  /\/DerivedData\//,
  /\/\.cache\//,
  /\.part$/,           // yarım indirme
  /\.tmp$|\.temp$/,
];

/** Bir yolun risk sınıfı. Sıra önemli: NEVER her şeyi ezer. */
export function classifyRisk(path: string): Risk {
  const p = String(path ?? "");
  if (NEVER.some((r) => r.test(p))) return "never";
  if (SAFE.some((r) => r.test(p))) return "safe";
  return "review";
}

export interface Ranked extends FileItem {
  risk: Risk;
  /** Sıralama puanı — büyük + güvenli + eski önce gelir. */
  rank: number;
}

const RISK_WEIGHT: Record<Risk, number> = { safe: 1, review: 0.35, never: 0 };

/** Geri kazanılabilirliğe göre sırala. `never` sınıfı listede kalır ama puanı 0'dır:
 *  gizlemek yerine görünür ve en sonda tutulur. */
export function rankReclaimable(items: FileItem[], now: number = 0): Ranked[] {
  return items
    .map((i) => {
      const risk = classifyRisk(i.path);
      const ageDays = i.mtime && now ? Math.max(0, (now - i.mtime) / 86_400_000) : 0;
      const ageFactor = 1 + Math.min(1, ageDays / 180); // 6 ay+ → ×2
      return { ...i, risk, rank: i.bytes * RISK_WEIGHT[risk] * ageFactor };
    })
    .sort((a, b) => b.rank - a.rank);
}

export interface DupGroup {
  bytes: number;
  paths: string[];
  /** Bu gruptan geri kazanılabilir: (kopya sayısı − 1) × boyut. */
  reclaimable: number;
}

/**
 * İKİ AŞAMALI kopya tespiti — birinci aşama.
 *
 * Aynı boyuttaki dosyalar "aday" gruplardır. Hash PAHALIDIR (GB'larca okuma), bu
 * yüzden yalnız boyut çakışanlar için hesaplanır. Bu fonksiyon hangi grupların
 * hash'lenmeye DEĞDİĞİNİ söyler; hash'i kabuk yapar.
 */
export function sizeBuckets(items: FileItem[], minBytes = 100 * 1024 * 1024): FileItem[][] {
  const by = new Map<number, FileItem[]>();
  for (const i of items) {
    if (i.bytes < minBytes) continue;
    const g = by.get(i.bytes);
    if (g) g.push(i); else by.set(i.bytes, [i]);
  }
  return [...by.values()].filter((g) => g.length > 1);
}

/** İkinci aşama: hash'e göre GERÇEK kopyalar. Aynı boyut ≠ aynı içerik. */
export function groupByHash(hashed: { path: string; bytes: number; hash: string }[]): DupGroup[] {
  const by = new Map<string, { path: string; bytes: number }[]>();
  for (const h of hashed) {
    const g = by.get(h.hash);
    if (g) g.push(h); else by.set(h.hash, [h]);
  }
  return [...by.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      bytes: g[0].bytes,
      paths: g.map((x) => x.path).sort(),
      reclaimable: (g.length - 1) * g[0].bytes,
    }))
    .sort((a, b) => b.reclaimable - a.reclaimable);
}

/** İnsan-okur boyut. */
export function humanBytes(n: number): string {
  const u = ["B", "K", "M", "G", "T"];
  let v = Math.max(0, n);
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)}${u[i]}`;
}
