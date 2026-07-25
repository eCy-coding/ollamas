// specialists — validate the eCym specialist registry (.ecym/specialists.json). PURE so the shape
// is checkable without disk (the bin reads the file). A registry is only useful if every specialist
// is uniquely named, has a domain, a real way to invoke it, and at least one capability; and the
// reward-ledger weights should sum to ~100. Anything else is a registry that lies about who does what.

export interface Specialist {
  id: string;
  domain: string;
  invoke: string;
  weight: number;
  capabilities: string[];
}
export interface Registry {
  version?: string;
  specialists: Specialist[];
}

export interface RegIssue {
  level: "error" | "warn";
  where: string;
  message: string;
}

/** Validate a specialist registry. Missing id/domain/invoke/capability = error; weights off ~100 = warn. */
export function validateSpecialists(reg: Registry): RegIssue[] {
  const out: RegIssue[] = [];
  const err = (where: string, message: string) => out.push({ level: "error", where, message });
  const warn = (where: string, message: string) => out.push({ level: "warn", where, message });

  if (!reg || typeof reg !== "object" || !Array.isArray(reg.specialists)) {
    return [{ level: "error", where: "registry", message: "no specialists array" }];
  }
  if (!reg.specialists.length) err("specialists", "empty registry");

  const ids = new Set<string>();
  for (const s of reg.specialists) {
    const at = s?.id || "(no id)";
    if (!s?.id?.trim()) err(at, "specialist has no id");
    else if (ids.has(s.id)) err(at, "duplicate id");
    else ids.add(s.id);
    if (!s?.domain?.trim()) err(at, "no domain");
    if (!s?.invoke?.trim()) err(at, "no invoke target (binary/endpoint)");
    if (!Array.isArray(s?.capabilities) || !s.capabilities.length) err(at, "no capabilities");
    if (typeof s?.weight !== "number" || s.weight < 0) err(at, "weight must be a non-negative number");
  }

  const total = reg.specialists.reduce((n, s) => n + (typeof s?.weight === "number" ? s.weight : 0), 0);
  if (reg.specialists.length && Math.abs(total - 100) > 1) warn("weights", `weights sum to ${total}, expected ~100`);
  return out;
}

export const isValidRegistry = (issues: RegIssue[]): boolean => !issues.some((i) => i.level === "error");
