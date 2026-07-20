// data/app-literacy.json yükleyicisi — saf eşleyiciler server/app-literacy.ts'te.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AppCard } from "../server/app-literacy";

export function loadAppCards(): AppCard[] {
  const p = join(process.cwd(), "data", "app-literacy.json");
  if (!existsSync(p)) return []; // dosya yoksa set boş — teach akışı düşmez
  try { return (JSON.parse(readFileSync(p, "utf8")).cards ?? []) as AppCard[]; }
  catch { return []; }
}
