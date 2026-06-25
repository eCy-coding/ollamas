/*
// Faz11 audit-capability benchmark fixture.
// 10 functions: 5 contain a realistic LOGIC bug (tsc-clean — the kind a code audit must catch),
// 5 are correct distractors. Ground-truth in bench-fixture.groundtruth.json.
// An auditor must read this file and report which functions are BROKEN (and why).

// --- 1: BUG — off-by-one, reads arr[arr.length] (undefined) → NaN
export function sumArray(arr: number[]): number {
  let total = 0;
  for (let i = 0; i <= arr.length; i++) total += arr[i];
  return total;
}

// --- 2: BUG — wrong operator, returns true for ODD numbers
export function isEven(n: number): boolean {
  return n % 2 === 1;
}

// --- 3: BUG — unhandled empty input, crashes on [] (arr[0] is undefined)
export function getFirstId(arr: { id: number }[]): number {
  return arr[0].id;
}

// --- 4: BUG — missing await, returns a Promise's .name (undefined) instead of the value
function loadUser(id: string): any {
  return Promise.resolve({ name: `user-${id}` });
}
export async function fetchUserName(id: string): Promise<string> {
  const u = loadUser(id);
  return u.name;
}

// --- 5: BUG — wrong default, parseInt returns NaN (not null) on bad input → ?? never fires → NaN
export function parsePort(s: string): number {
  return parseInt(s) ?? 8080;
}

// --- 6: CORRECT — clamp
export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// --- 7: CORRECT — slugify
export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// --- 8: CORRECT — dedupe preserving order
export function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// --- 9: CORRECT — safe divide with zero guard
export function safeDivide(a: number, b: number): number {
  if (b === 0) return 0;
  return a / b;
}

// --- 10: CORRECT — capitalize
export function capitalize(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}
*/