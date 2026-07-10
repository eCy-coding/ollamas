// Shared $0-local default helpers for the agent panels (ReAct Uzmanı, Pipeline Ajanı). Pure → unit-testable.
// justdoit: local models are the standing conductor, so a panel must be usable out-of-box with no API key.

export const DEFAULT_LOCAL_PROVIDER = "ollama-local";

// A model list from /api/models/:provider can contain error PLACEHOLDER strings when a cloud provider has
// no key ("API key not set", "not installed"). Pick the first REAL model, skipping placeholders; fall back
// to the first entry (so a degraded list still yields something) or "" when the list is empty.
export function firstUsableModel(list: readonly string[]): string {
  if (!Array.isArray(list) || list.length === 0) return "";
  const usable = list.find(
    (m) => typeof m === "string" && !/not set|API key|not installed|unavailable/i.test(m),
  );
  return usable ?? list[0];
}

// A freshly loaded list must not clobber a still-valid selection: new host tags (e.g. aligned
// "-ca" variants) can reorder list[0] and would otherwise silently replace the panel default.
export function preferredOrFirstUsable(list: readonly string[], current: string): string {
  if (!Array.isArray(list) || list.length === 0) return "";
  if (current && list.includes(current)) return current;
  return firstUsableModel(list);
}
