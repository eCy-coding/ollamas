// fleet-conduct-lib (pure) — extract exactly ONE proposal from a worker report's messages. IO-free → unit-tested.
//
// Why: living fleet workers sometimes emit the proposal text TWICE in their final messages (the model repeats
// the whole `## Plan … VERDICT: DONE` block). The old extractor sliced from the first "## Change" to the END of
// the joined messages, so PROPOSAL.md captured BOTH copies → duplicate SEARCH/REPLACE blocks. That is harmless
// only by luck (the 2nd apply is a no-op). Root fix: a proposal is ONE unit that ends at its first `VERDICT:`
// line — slice from the first `## Plan`/`## Change` marker up to and including that line, dropping the repeat.

/** Extract a single clean proposal from a report's final messages (Change/Diff/Test shape, VERDICT-terminated). */
export function extractOneProposal(messages: unknown): string {
  const arr = Array.isArray(messages) ? messages.map((m) => String(m)) : [];
  const joined = arr.join("\n").trim();
  // Start at the first requested-shape marker (## Plan or ## Change); else fall back to the last message.
  const start = joined.search(/##\s*(?:Plan|Change)\b/i);
  const body = start >= 0 ? joined.slice(start) : (arr[arr.length - 1] ?? "").trim();
  // Terminate at the FIRST `VERDICT:` line — the proposal's end marker. Anything after (a repeated 2nd copy)
  // is dropped. `.` excludes newlines, `m` makes ^/$ per-line, so this matches just the VERDICT line.
  const vm = /^.*VERDICT:.*$/im.exec(body);
  const cut = vm ? body.slice(0, vm.index + vm[0].length) : body;
  return cut.trim();
}
