// macOS'ta os.freemem() SADECE "Pages free"i sayar; inactive/purgeable/speculative
// sayfalar anında geri-kazanılabilir olsa da hariç → RAM hep ~%99 dolu görünür (yanıltıcı).
// Gerçek "available" = free + inactive + purgeable + speculative. vm_stat bunu verir.
// Saf parser (parseVmStat) socket/disk-siz test edilir; memoryUsage IO sarmalıdır ve
// darwin-dışı VEYA parse/exec hatasında eski os.freemem() hesabına düşer (asla throw).
import os from "node:os";
import { execFileSync } from "node:child_process";

export interface MemoryUsage {
  total: number;
  /** Anında kullanılabilir bayt (macOS: free+inactive+purgeable+speculative; else os.freemem). */
  free: number;
  percentageUsed: number;
}

/** vm_stat metnini + sayfa boyutunu alıp available bayt döndürür. Bilinmeyen satır/eksik
 *  alan → o alan 0 sayılır (en azından free'yi yakalar). Sayfa değerleri sonunda "." olabilir. */
export function parseVmStat(vmStatOutput: string, pageSize: number): number {
  const pagesOf = (label: string): number => {
    // "Pages free:                               35564."
    const re = new RegExp(`Pages ${label}:\\s+(\\d+)`);
    const m = vmStatOutput.match(re);
    return m ? parseInt(m[1], 10) : 0;
  };
  const availablePages =
    pagesOf("free") + pagesOf("inactive") + pagesOf("purgeable") + pagesOf("speculative");
  return availablePages * pageSize;
}

/** Gerçek bellek kullanımını hesaplar. macOS'ta vm_stat kullanır; her hata/non-darwin'de
 *  os.freemem() fallback. Yanıt şekli health endpoint ile birebir aynı (total/free/percentageUsed). */
export function memoryUsage(totalBytes: number = os.totalmem()): MemoryUsage {
  const fallback = (): MemoryUsage => {
    const free = os.freemem();
    return { total: totalBytes, free, percentageUsed: Number(((1 - free / totalBytes) * 100).toFixed(1)) };
  };
  if (process.platform !== "darwin") return fallback();
  try {
    const out = execFileSync("/usr/bin/vm_stat", { encoding: "utf-8", timeout: 2000 });
    // Sayfa boyutu vm_stat başlığında ("page size of 16384 bytes"); yoksa 4096 varsay.
    const psMatch = out.match(/page size of (\d+) bytes/);
    const pageSize = psMatch ? parseInt(psMatch[1], 10) : 4096;
    const available = parseVmStat(out, pageSize);
    if (available <= 0 || available > totalBytes) return fallback(); // saçma değer → güven verme
    return {
      total: totalBytes,
      free: available,
      percentageUsed: Number(((1 - available / totalBytes) * 100).toFixed(1)),
    };
  } catch {
    return fallback();
  }
}
