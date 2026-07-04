import { describe, it, expect } from "vitest";
import os from "node:os";
import { parseVmStat, memoryUsage } from "../server/memory-stats";

// Gerçek yakalanmış vm_stat çıktısı (macOS, 16384 sayfa boyutu, 48GB makine).
const VM_STAT_FIXTURE = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               35564.
Pages active:                            587939.
Pages inactive:                          561733.
Pages speculative:                        29937.
Pages throttled:                              0.
Pages wired down:                       1058245.
Pages purgeable:                          18829.
"Translation faults":               22629859162.
Pages copy-on-write:                  882085841.
File-backed pages:                       225109.
Anonymous pages:                         954500.`;

describe("parseVmStat", () => {
  it("sums free+inactive+purgeable+speculative × pageSize", () => {
    // (35564 + 561733 + 18829 + 29937) × 16384
    const expected = (35564 + 561733 + 18829 + 29937) * 16384;
    expect(parseVmStat(VM_STAT_FIXTURE, 16384)).toBe(expected);
  });

  it("returns a far more available value than free-pages alone", () => {
    const available = parseVmStat(VM_STAT_FIXTURE, 16384);
    const freeOnly = 35564 * 16384;
    expect(available).toBeGreaterThan(freeOnly * 10); // free alone is ~1/18 of available
  });

  it("treats missing fields as zero without throwing", () => {
    expect(parseVmStat("Pages free: 100.", 4096)).toBe(100 * 4096);
    expect(parseVmStat("garbage", 4096)).toBe(0);
  });
});

describe("memoryUsage", () => {
  it("returns a sane, health-shaped object with percentageUsed in [0,100]", () => {
    const total = os.totalmem();
    const m = memoryUsage(total);
    expect(m.total).toBe(total);
    expect(m.free).toBeGreaterThan(0);
    expect(m.free).toBeLessThanOrEqual(total);
    expect(m.percentageUsed).toBeGreaterThanOrEqual(0);
    expect(m.percentageUsed).toBeLessThanOrEqual(100);
  });

  it("on macOS reports lower usage than the naive os.freemem() calc (inactive counted)", () => {
    if (process.platform !== "darwin") return; // fallback path is os.freemem() itself
    const total = os.totalmem();
    const naive = Number(((1 - os.freemem() / total) * 100).toFixed(1));
    const corrected = memoryUsage(total).percentageUsed;
    expect(corrected).toBeLessThanOrEqual(naive);
  });
});
