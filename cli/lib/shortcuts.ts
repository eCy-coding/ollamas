// Apple Shortcuts pack — PURE core (v6). No I/O here; emits WFWorkflow XML
// plists + human recipe cards as strings → unit-testable without a disk or a
// socket. The compiled `.shortcut` Apple ships is SIGNED (AEA); an unsigned file
// can NOT be imported on iOS, so v6 does not pretend to ship a double-click
// iPhone binary. It emits a well-formed XML WFWorkflow scaffold (zero-dep, no
// plist npm lib) that macOS re-signs via `shortcuts import`, plus a recipe card
// the user can follow by hand on pure-iOS. Shape/keys ported from the
// WFWorkflowActionIdentifier vocabulary documented by joshfarrant/shortcuts-js
// (GPL — IDEA-ONLY reference, no code copied) and the downloadurl+header recipe
// from drewburchfield/shortcuts-toolkit (MIT).
//
// SECURITY: the core is key-AGNOSTIC. Auth flows in as a plain string param so
// the default placeholder (API_KEY_PLACEHOLDER) is what lands in the plist; a
// real key only ever appears when the I/O shell is explicitly told to embed one
// (`shortcuts build --embed-key`). Tests assert the placeholder round-trips.

// What `--embed-key` replaces. The recipe card tells the user to swap this for
// their OLLAMAS_API_KEY by hand (the safe default).
export const API_KEY_PLACEHOLDER = "__OLLAMAS_API_KEY__";

// Where a dynamic user prompt gets wired in Shortcuts (an "Ask for Input" magic
// variable). We can't author the variable UUID graph reliably from a file, so
// the scaffold uses a literal placeholder and the recipe card carries the
// manual wiring step.
export const PROMPT_PLACEHOLDER = "__PROMPT__";

// --- plist serialization (pure) -------------------------------------------

// Escape the five XML metacharacters for plist text/keys.
export function plistEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Serialize a JS value to an Apple plist value. Supports string/number/boolean/
// array/dict. Integers vs reals are split on Number.isInteger (Shortcuts cares).
export function plistValue(v: unknown): string {
  if (typeof v === "string") return `<string>${plistEscape(v)}</string>`;
  if (typeof v === "boolean") return v ? "<true/>" : "<false/>";
  if (typeof v === "number") {
    return Number.isInteger(v) ? `<integer>${v}</integer>` : `<real>${v}</real>`;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return "<array/>";
    return `<array>${v.map(plistValue).join("")}</array>`;
  }
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return "<dict/>";
    const body = entries.map(([k, val]) => `<key>${plistEscape(k)}</key>${plistValue(val)}`).join("");
    return `<dict>${body}</dict>`;
  }
  // null/undefined → empty string (drops cleanly when a field is absent)
  return "<string></string>";
}

// --- WFWorkflow assembly (pure) -------------------------------------------

export interface WFAction {
  WFWorkflowActionIdentifier: string;
  WFWorkflowActionParameters: Record<string, unknown>;
}

export function wfAction(id: string, params: Record<string, unknown> = {}): WFAction {
  return { WFWorkflowActionIdentifier: id, WFWorkflowActionParameters: params };
}

// Wrap an action list in the top-level WFWorkflow plist envelope.
// Client-version keys mirror a real Shortcuts export so `plutil`/`shortcuts`
// accept the structure; importing still re-signs locally on macOS.
export function buildWorkflowPlist(actions: WFAction[]): string {
  const root = {
    WFWorkflowClientVersion: "2000",
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: "900",
    WFWorkflowIcon: {
      WFWorkflowIconStartColor: 463140863,
      WFWorkflowIconGlyphNumber: 61440,
    },
    WFWorkflowImportQuestions: [],
    WFWorkflowTypes: ["WatchKit", "ActionExtension", "NCWidget"],
    WFWorkflowInputContentItemClasses: ["WFStringContentItem"],
    WFWorkflowActions: actions,
  };
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    plistValue(root),
    "</plist>",
    "",
  ].join("\n");
}

// --- HTTP-request action helper (pure) ------------------------------------

interface RequestSpec {
  url: string;
  method: "GET" | "POST";
  auth: string;
  body?: unknown; // JSON object — serialized into WFJSONValues
}

// Build a `Get Contents of URL` (downloadurl) action. Headers always carry the
// Bearer auth string the caller supplied. A JSON body, when present, lands in
// WFJSONValues (the static-fields form — dynamic wiring is a documented card
// step). Content-Type only set when there is a body.
function requestAction(spec: RequestSpec): WFAction {
  const headers: Record<string, string> = { Authorization: `Bearer ${spec.auth}` };
  const params: Record<string, unknown> = {
    WFURL: spec.url,
    WFHTTPMethod: spec.method,
  };
  if (spec.body !== undefined) {
    headers["Content-Type"] = "application/json";
    params.WFHTTPBodyType = "JSON";
    params.WFJSONValues = spec.body;
  }
  params.WFHTTPHeaders = headers;
  return wfAction("is.workflow.actions.downloadurl", params);
}

function commentAction(text: string): WFAction {
  return wfAction("is.workflow.actions.comment", { WFCommentActionText: text });
}

function showResultAction(): WFAction {
  // Surface the response text to the user (Quick Look on iOS / Show Result).
  return wfAction("is.workflow.actions.showresult", {
    Text: { Value: { string: "Provided Input" }, WFSerializationType: "WFTextTokenString" },
  });
}

// --- recipes (pure) -------------------------------------------------------

export interface Recipe {
  slug: string;
  name: string;
  description: string;
  actions: WFAction[];
}

// One-shot chat. stream:false is mandatory — Shortcuts cannot consume SSE.
export function recipeChat(gateway: string, auth: string, model: string, provider: string): Recipe {
  const body = {
    provider,
    model,
    stream: false,
    messages: [{ role: "user", content: PROMPT_PLACEHOLDER }],
  };
  return {
    slug: "chat",
    name: "ollamas chat",
    description: "Ask the gateway one question and show the answer (stream:false).",
    actions: [
      commentAction(`ollamas chat → ${gateway}/api/generate\nWire the "Ask for Input" result into messages[0].content (replaces ${PROMPT_PLACEHOLDER}).`),
      requestAction({ url: `${gateway}/api/generate`, method: "POST", auth, body }),
      showResultAction(),
    ],
  };
}

// Health probe — GET /api/health, no body.
export function recipeStatus(gateway: string, auth: string): Recipe {
  return {
    slug: "status",
    name: "ollamas status",
    description: "Probe gateway health from the phone.",
    actions: [
      commentAction(`ollamas status → ${gateway}/api/health`),
      requestAction({ url: `${gateway}/api/health`, method: "GET", auth }),
      showResultAction(),
    ],
  };
}

// Bench — a single non-stream generation with an echo-proof prompt (N-006); the
// server returns latencyMs in the non-stream body for the user to read.
export function recipeBench(gateway: string, auth: string, model: string, provider: string): Recipe {
  const body = {
    provider,
    model,
    stream: false,
    messages: [{ role: "user", content: "What is 2+2? Reply only the number." }],
  };
  return {
    slug: "bench",
    name: "ollamas bench",
    description: "One-shot latency probe (reads latencyMs from the response).",
    actions: [
      commentAction(`ollamas bench → ${gateway}/api/generate (echo-proof prompt; read latencyMs)`),
      requestAction({ url: `${gateway}/api/generate`, method: "POST", auth, body }),
      showResultAction(),
    ],
  };
}

// MCP tools/call over the gateway choke-point. Tool name + args are placeholders
// the user edits (or wires via Ask) — kept stream-free.
export function recipeMcpCall(gateway: string, auth: string): Recipe {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "__TOOL__", arguments: {} },
  };
  return {
    slug: "mcp-call",
    name: "ollamas mcp call",
    description: "Invoke an MCP tool via /mcp (edit __TOOL__ + arguments).",
    actions: [
      commentAction(`ollamas mcp call → ${gateway}/mcp (set params.name + arguments)`),
      requestAction({ url: `${gateway}/mcp`, method: "POST", auth, body }),
      showResultAction(),
    ],
  };
}

// --- Siri local Run-Shell action builders (pure) --------------------------
// These build the three WFActions the on-device "ollamas sor" Shortcut needs.
// Unlike the gateway recipes, siri runs a LOCAL shell (no server) — the brain is
// bin/siri-ask.mjs. Exported individually so the generator + tests can assert them.

// "Ask for Input" — prompts the user for the question (Siri speaks/types this).
export function askAction(question: string): WFAction {
  return wfAction("is.workflow.actions.ask", { WFAskActionPrompt: question, WFInputType: "Text" });
}

// "Run Shell Script" — runs `script` with the provided input passed AS ARGUMENTS
// ("$@" = the question). The generator reads WFShellScript verbatim to build the card.
export function runShellAction(script: string): WFAction {
  return wfAction("is.workflow.actions.runshellscript", {
    WFShellScript: script,
    WFInputType: "asArguments",
    WFShell: "/bin/bash",
  });
}

// "Speak Text" — reads a result aloud in `voice`. Exported for a future spoken
// variant; recipeSiri deliberately omits it (text-only output).
export function speakAction(voice: string): WFAction {
  return wfAction("is.workflow.actions.speaktext", { WFSpeakTextVoice: voice });
}

// The load-bearing shell for the Siri Shortcut. Self-contained (absolute node +
// repo paths — Shortcuts' Run-Shell has a minimal PATH), hardened: pins ORACLE_SOCK
// to the warm daemon socket and self-ensures the daemon (fast deterministic path)
// before delegating the question ("$@") to the standalone brain.
function siriShellScript(repo: string): string {
  return [
    "#!/bin/bash",
    "export ORACLE_SOCK=/tmp/ollamas-oracle.sock",
    `# daemon self-ensure: start the warm truth-oracle if its socket is absent (ms-path).`,
    `if [ ! -S "$ORACLE_SOCK" ]; then`,
    `  "${repo}/node_modules/.bin/tsx" "${repo}/orchestration/bin/oracle-serve.ts" >/dev/null 2>&1 &`,
    `  sleep 1`,
    `fi`,
    `exec /opt/homebrew/bin/node "${repo}/bin/siri-ask.mjs" "$@"`,
  ].join("\n");
}

// "ollamas sor" — the on-device Siri search assistant. Ask → local shell (siri-ask
// brain: Oracle verdict / deep web + fleet synth) → show result AS TEXT (no speech).
// `voice` is accepted for signature symmetry with the spoken variant but unused here.
export function recipeSiri(repo: string, voice: string): Recipe {
  void voice; // text-only surface — speakAction intentionally omitted (see plist assertion)
  return {
    slug: "siri",
    name: "ollamas sor",
    description: "Siri yerel arama yardımcısı: soru → siri-ask beyni → metin yanıt (server gerekmez).",
    actions: [
      askAction("Ne sormak istersin?"),
      runShellAction(siriShellScript(repo)),
      showResultAction(),
    ],
  };
}

// The full pack, in stable slug order.
export function allRecipes(gateway: string, auth: string, model: string, provider: string): Recipe[] {
  return [
    recipeChat(gateway, auth, model, provider),
    recipeStatus(gateway, auth),
    recipeBench(gateway, auth, model, provider),
    recipeMcpCall(gateway, auth),
  ];
}

// Human, followable manual-install card for pure-iOS (no macOS to re-sign).
// Lists the actions to add by hand and the load-bearing constraints.
export function recipeCard(r: Recipe): string {
  const lines = [
    `# ${r.name}  (${r.slug})`,
    r.description,
    "",
    "Build by hand in the Shortcuts app:",
  ];
  r.actions.forEach((a, i) => {
    const id = a.WFWorkflowActionIdentifier.replace("is.workflow.actions.", "");
    const p = a.WFWorkflowActionParameters;
    let detail = id;
    if (id === "downloadurl") {
      const headers = (p.WFHTTPHeaders as Record<string, string>) || {};
      detail = `Get Contents of URL → ${p.WFHTTPMethod} ${p.WFURL}`;
      detail += `\n        header Authorization: ${headers.Authorization}`;
      if (p.WFJSONValues) detail += `\n        JSON body: ${JSON.stringify(p.WFJSONValues)}`;
    } else if (id === "comment") {
      detail = `Comment: ${String(p.WFCommentActionText).split("\n")[0]}`;
    } else if (id === "showresult") {
      detail = "Show Result (the response)";
    }
    lines.push(`  ${i + 1}. ${detail}`);
  });
  lines.push(
    "",
    "Notes:",
    `  • Replace ${API_KEY_PLACEHOLDER} with your OLLAMAS_API_KEY (keep it off shared devices).`,
    "  • Keep stream:false — Shortcuts cannot read Server-Sent Events.",
    "  • For a real gateway over the internet, expose it with `tailscale serve` (see cli/REMOTE_EXPOSURE.md).",
  );
  return lines.join("\n");
}
