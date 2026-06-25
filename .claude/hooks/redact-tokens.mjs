#!/usr/bin/env node
// PreToolUse safety hook (registered for Write|Edit only) — block writing a literal secret
// VALUE into a file. Read-protection for .env lives in permissions.deny (this hook fires
// before a tool runs, so it never sees file CONTENTS — only what the model is about to write).
// Modern signal: hookSpecificOutput.permissionDecision="deny" on exit 0 (works even under
// bypass mode; parser-safe). Diagnostics go to stderr; stdout is ONLY the decision JSON.

let raw = "";
process.stdin.on("data", (c) => (raw += c)).on("end", () => {
  let p = {};
  try { p = JSON.parse(raw || "{}"); } catch { process.exit(0); }
  const hay = JSON.stringify(p.tool_input ?? {});

  const SECRETS = [
    /\bsk-[A-Za-z0-9]{20,}\b/,                              // OpenAI / Anthropic
    /\bghp_[A-Za-z0-9]{30,}\b/,                             // GitHub PAT
    /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,                     // GitHub fine-grained PAT
    /\bAIza[0-9A-Za-z_\-]{30,}\b/,                          // Google / Gemini
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,                     // Slack
    /\bAKIA[0-9A-Z]{16}\b/,                                 // AWS access key id
    /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, // private keys
    /\bBearer\s+[A-Za-z0-9._\-]{24,}\b/,                    // inline bearer value
  ];

  for (const re of SECRETS) {
    if (re.test(hay)) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            "Literal secret value detected in the content being written. Reference it via env var ($NAME) or the keychain — never inline a credential.",
        },
      }));
      process.exit(0);
    }
  }
  process.exit(0);
});
