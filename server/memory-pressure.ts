// Memory-pressure assessment for the e2e gate.
//
// Measured 2026-07-22: com.odysseus.server reached 668 restarts. It binds :7860 about 210s
// after start, serves for roughly a minute, then dies by SIGKILL — a wrapper installed to
// catch the exit never managed to write its STOP line, and swap held at ~22.4 GB of 23.5 GB
// throughout. Four hypotheses were chased and eliminated first (the watchdog, the odysseus
// orchestrator, a double bind, PATH) purely because the gate said "odysseus-bridge red"
// without saying anything about the machine it was running on.
//
// This module exists so that never happens again. It does not fix memory pressure — it
// makes it visible in the same JSON the watchdog already consumes, next to the leg it
// explains.

export interface SwapUsage { totalMb: number; usedMb: number; freeMb: number }

export interface MemorySample {
  swap: SwapUsage | null;
  /** Resident size of the largest process, in GiB. */
  topRssGb: number;
  topName: string;
}

/** Swap use above this fraction is treated as the machine being out of room. */
export const DEFAULT_SWAP_THRESHOLD = 0.9;

const toMb = (value: string, unit: string): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return unit.toUpperCase() === "G" ? n * 1024 : n;
};

/**
 * Parse `sysctl -n vm.swapusage`, e.g.
 *   total = 23552.00M  used = 22173.88M  free = 1378.12M  (encrypted)
 * Returns null rather than a partial guess — a wrong number here would produce a false red.
 */
export function parseSwapUsage(raw: string): SwapUsage | null {
  const grab = (key: string): number => {
    const m = new RegExp(`${key}\\s*=\\s*([0-9.]+)([MG])`, "i").exec(raw);
    return m ? toMb(m[1], m[2]) : NaN;
  };
  const totalMb = grab("total");
  const usedMb = grab("used");
  const freeMb = grab("free");
  if (![totalMb, usedMb, freeMb].every(Number.isFinite)) return null;
  return { totalMb, usedMb, freeMb };
}

export function assessMemory(
  sample: MemorySample,
  threshold = DEFAULT_SWAP_THRESHOLD,
): { ok: boolean; detail: string } {
  const top = `top=${sample.topName} ${sample.topRssGb.toFixed(1)}GB`;

  if (!sample.swap) {
    // Never fail a leg because a probe could not run; say so instead.
    return { ok: true, detail: `swap unavailable (probe failed) ${top}` };
  }

  const { totalMb, usedMb } = sample.swap;
  if (totalMb <= 0) {
    return { ok: true, detail: `swap disabled ${top}` };
  }

  const ratio = usedMb / totalMb;
  const pct = Math.round(ratio * 100);
  const detail =
    `swap ${(usedMb / 1024).toFixed(1)}G/${(totalMb / 1024).toFixed(1)}G (${pct}%) ${top}`;

  if (ratio >= threshold) {
    return {
      ok: false,
      detail: `${detail} — services in jetsam band get SIGKILLed at this level`,
    };
  }
  return { ok: true, detail };
}
