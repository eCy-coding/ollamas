// Shell completion — PURE core (v9). Zero-dep, hand-rolled (no tabtab/yargs).
// Pattern ported from gh CLI / npm completion (MIT): a static per-shell script
// (printed by `ollamas completion <shell>`) registers a function that, on TAB,
// calls back `ollamas __complete <words…>`; that hidden command returns the
// candidate set for the current position, one per line. The SHELL does the
// prefix filtering — we return the FULL set for the position, never a filtered
// one (double-filtering breaks zsh/fish matching).
//
// `__complete` MUST stay pure + side-effect-free + fast: it runs on every TAB,
// so it never touches the network or loads config — just this tree lookup.

export interface CommandTree {
  commands: string[];
  subActions: Record<string, string[]>;
  globalFlags: string[];
}

// Single source of truth for the command surface (mirrors index.ts + commands/).
export const COMMAND_TREE: CommandTree = {
  commands: [
    "chat",
    "agent",
    "saas",
    "mcp",
    "backup",
    "bench",
    "top",
    "shortcuts",
    "remote",
    "gemini",
    "doctor",
    "config",
    "completion",
    "update",
    "plugin",
    "man",
    "help",
    "version",
  ],
  subActions: {
    agent: ["sessions", "rm"],
    saas: ["plans", "tenants", "tenant", "keys", "key", "audit", "usage", "billing"],
    mcp: ["info", "tools", "call", "resources", "read", "prompts", "prompt", "upstreams", "add", "rm"],
    backup: ["config", "trigger", "download", "restore"],
    shortcuts: ["build"],
    // config: profile ops + the settable keys
    config: ["use", "profiles", "keystore", "gateway", "model", "provider", "apiKey", "saasAdminToken"],
    remote: ["check", "discover", "add", "rm", "ls", "pick", "up"],
    gemini: ["setup-mcp", "status", "lane"],
    completion: ["bash", "zsh", "fish"],
    plugin: ["list", "install", "remove"],
    update: ["--check"],
  },
  globalFlags: ["--gateway", "--profile", "--insecure-storage", "--json", "--help"],
};

// Dynamic VALUE candidates, injected by the __complete handler (v13). Kept OUT of
// this pure function so it stays unit-testable and so TAB never triggers I/O here —
// the handler gathers these from LOCAL disk only (profiles + a model cache), never a
// network call (N-019).
export interface DynamicValues {
  profiles?: string[]; // listProfiles().map(p => p.name)
  models?: string[]; // cached models for the active provider
  providers?: string[]; // PROVIDERS
}

// Candidate set for the position implied by `words` (the args BEFORE the cursor).
// - 0 words / single empty word → top-level commands + global flags
// - the command word → that command's sub-actions
// - a value slot (`-m`/`--model`, `-p`/`--provider`, `config use`) → injected dyn
// Pure → unit-testable. Returns the full set; the shell prefix-filters.
export function complete(words: string[], dyn: DynamicValues = {}): string[] {
  const real = words.filter((w, i) => !(i === words.length - 1 && w === ""));
  if (real.length === 0) {
    return [...COMMAND_TREE.commands, ...COMMAND_TREE.globalFlags];
  }

  // Value slots — the token right before the cursor names what value comes next.
  // Checked before the sub-action lookup so `chat -m <TAB>` works at any depth.
  const prev = real[real.length - 1];
  if ((prev === "-m" || prev === "--model") && dyn.models) return dyn.models;
  if ((prev === "-p" || prev === "--provider") && dyn.providers) return dyn.providers;
  if (real.length >= 2 && real[real.length - 2] === "config" && prev === "use" && dyn.profiles) {
    return dyn.profiles;
  }

  if (real.length === 1) {
    const cmd = real[0];
    if (!COMMAND_TREE.commands.includes(cmd)) return [];
    return COMMAND_TREE.subActions[cmd] ?? [];
  }
  // Deeper positions with no recognized value slot → no static candidates.
  return [];
}

// Emit a static completion script for a shell. The script calls `<bin> __complete`
// with the current words and feeds the lines back to the shell's matcher.
export function completionScript(shell: "bash" | "zsh" | "fish", bin = "ollamas"): string {
  if (shell === "bash") {
    return `# ${bin} bash completion — eval "$(${bin} completion bash)"
_${bin}() {
  local words
  words=("\${COMP_WORDS[@]:1:COMP_CWORD-1}")
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local cands
  cands="$(${bin} __complete "\${words[@]}")"
  COMPREPLY=($(compgen -W "\${cands}" -- "\${cur}"))
}
complete -F _${bin} ${bin}
`;
  }
  if (shell === "zsh") {
    return `#compdef ${bin}
# ${bin} zsh completion — ${bin} completion zsh > "\${fpath[1]}/_${bin}"
_${bin}() {
  local -a cands
  cands=(\${(f)"$(${bin} __complete "\${words[@]:1:$#words-2}")"})
  compadd -- $cands
}
compdef _${bin} ${bin}
`;
  }
  // fish
  return `# ${bin} fish completion — ${bin} completion fish > ~/.config/fish/completions/${bin}.fish
function __${bin}_complete
  set -l tokens (commandline -opc)
  ${bin} __complete $tokens[2..-1]
end
complete -c ${bin} -f -a "(__${bin}_complete)"
`;
}
