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
    "bench",
    "top",
    "shortcuts",
    "doctor",
    "config",
    "completion",
    "help",
    "version",
  ],
  subActions: {
    agent: ["sessions", "rm"],
    saas: ["plans", "tenants", "tenant", "keys", "key", "audit", "usage", "billing"],
    mcp: ["info", "tools", "call", "upstreams", "add", "rm"],
    shortcuts: ["build"],
    // config: profile ops + the settable keys
    config: ["use", "profiles", "gateway", "model", "provider", "apiKey", "saasAdminToken"],
    completion: ["bash", "zsh", "fish"],
  },
  globalFlags: ["--gateway", "--profile", "--json", "--help"],
};

// Candidate set for the position implied by `words` (the args BEFORE the cursor).
// - 0 words or a single empty word → top-level commands + global flags
// - exactly the command word → that command's sub-actions (or [])
// Pure → unit-testable. Returns the full set; the shell prefix-filters.
export function complete(words: string[]): string[] {
  const real = words.filter((w, i) => !(i === words.length - 1 && w === ""));
  if (real.length === 0) {
    return [...COMMAND_TREE.commands, ...COMMAND_TREE.globalFlags];
  }
  if (real.length === 1) {
    const cmd = real[0];
    if (!COMMAND_TREE.commands.includes(cmd)) return [];
    return COMMAND_TREE.subActions[cmd] ?? [];
  }
  // Deeper positions: no further static candidates (dynamic values land in v13).
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
