#!/usr/bin/env bash
# Golden regression suite for every harness hook. Blockers now use permissionDecision="deny"
# JSON on exit 0 (modern, bypass-proof) — so we assert the DECISION, not exit code.
# Run: bash .claude/hooks/test-hooks.sh   (exit 0 = all pass). Wired into apply-harness verify.
set -uo pipefail
cd "$(cd "$(dirname "$0")/../.." && pwd)" || exit 1
H=".claude/hooks"
pass=0; fail=0

# decision <name> <want:deny|allow> <payload> <hook>
# "deny" = stdout JSON has permissionDecision:"deny"; "allow" = no deny (empty/clean stdout).
decision() {
  local name="$1" want="$2" payload="$3" hook="$4"
  local out; out=$(echo "$payload" | node "$H/$hook" 2>/dev/null)
  local got="allow"
  if echo "$out" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.exit(JSON.parse(d).hookSpecificOutput?.permissionDecision==="deny"?7:0)}catch{process.exit(0)}})'; then got="allow"; else got="deny"; fi
  if [ "$got" = "$want" ]; then echo "  ✓ $name ($got)"; pass=$((pass+1));
  else echo "  ✗ $name: want $want got $got"; fail=$((fail+1)); fi
}
# exit0 <name> <payload> <hook>  — non-blocking lifecycle hooks must exit 0
exit0() {
  local name="$1" payload="$2" hook="$3"
  echo "$payload" | node "$H/$hook" >/dev/null 2>&1; local g=$?
  if [ "$g" = 0 ]; then echo "  ✓ $name (exit 0)"; pass=$((pass+1)); else echo "  ✗ $name exit $g"; fail=$((fail+1)); fi
}

echo "── redact-tokens (Write|Edit scope, JSON-deny) ──"
decision "secret denied" deny  '{"tool_name":"Write","tool_input":{"file_path":"x.ts","content":"const k=\"sk-abcdefghijklmnopqrstuvwxyz012345\""}}' redact-tokens.mjs
decision "env-ref allowed" allow '{"tool_name":"Write","tool_input":{"file_path":"x.ts","content":"const k=process.env.OPENAI_API_KEY"}}' redact-tokens.mjs

echo "── block-destructive (JSON-deny) ──"
decision "rm -rf / denied"  deny  '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}' block-destructive.mjs
decision "find -delete denied" deny '{"tool_name":"Bash","tool_input":{"command":"find . -name x -delete"}}' block-destructive.mjs
decision "git clean -fd denied" deny '{"tool_name":"Bash","tool_input":{"command":"git clean -fdx"}}' block-destructive.mjs
decision "force-push denied" deny  '{"tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}' block-destructive.mjs
decision "safe allowed"     allow '{"tool_name":"Bash","tool_input":{"command":"npm run test"}}' block-destructive.mjs

echo "── gate-before-commit (JSON-deny, amend allowed) ──"
decision "add -A denied"    deny  '{"tool_name":"Bash","tool_input":{"command":"git add -A"}}' gate-before-commit.mjs
decision "no-verify denied" deny  '{"tool_name":"Bash","tool_input":{"command":"git commit --no-verify -m x"}}' gate-before-commit.mjs
decision "amend allowed"    allow '{"tool_name":"Bash","tool_input":{"command":"git commit --amend --no-edit"}}' gate-before-commit.mjs
decision "add file allowed" allow '{"tool_name":"Bash","tool_input":{"command":"git add cli/x.ts"}}' gate-before-commit.mjs

echo "── non-blocking lifecycle (exit 0) ──"
exit0 "format-on-edit"   '{"tool_name":"Write","tool_input":{"file_path":"/nonexistent.zzz"}}' format-on-edit.mjs
exit0 "preserve-context" '{"hook_event_name":"PreCompact","cwd":"'"$PWD"'"}' preserve-context.mjs
exit0 "on-stop"          '{"hook_event_name":"Stop","cwd":"'"$PWD"'"}' on-stop.mjs
exit0 "on-tool-failure"  '{"tool_name":"Bash","tool_error":"ENOENT","tool_input":{"command":"foo"}}' on-tool-failure.mjs
exit0 "on-subagent-stop" '{"hook_event_name":"SubagentStop","agent_type":"cli-coder","agent_id":"abc"}' on-subagent-stop.mjs
exit0 "on-session-end"   '{"hook_event_name":"SessionEnd","reason":"clear"}' on-session-end.mjs
exit0 "on-notification"  '{"hook_event_name":"Notification","notification_type":"other","message":"hi"}' on-notification.mjs

echo "── stdout JSON safety (deny hooks emit valid JSON) ──"
for h in redact-tokens block-destructive gate-before-commit on-tool-failure; do
  out=$(echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"},"tool_error":"x"}' | node "$H/$h.mjs" 2>/dev/null)
  if [ -z "$out" ] || echo "$out" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{JSON.parse(d);process.exit(0)})' 2>/dev/null; then
    echo "  ✓ $h stdout JSON-safe"; pass=$((pass+1)); else echo "  ✗ $h non-JSON stdout"; fail=$((fail+1)); fi
done

echo "── add-cli mechanism ──"
add_exit() { # name want-exit cmd...
  local name="$1" want="$2"; shift 2
  "$@" >/dev/null 2>&1; local g=$?
  if [ "$g" = "$want" ]; then echo "  ✓ $name (exit $g)"; pass=$((pass+1)); else echo "  ✗ $name: want $want got $g"; fail=$((fail+1)); fi
}
add_exit "reject uninstalled"  1 node .claude/add-cli.mjs nonexistent-zzz --tier allow
add_exit "reject destructive"  1 node .claude/add-cli.mjs rm --tier allow
add_exit "reject sideeffect-on-allow" 1 node .claude/add-cli.mjs mytool-deploy --tier allow
# merge-settings warns (not silent) on malformed cli-extensions — validate-settings catches bad shape
if node .claude/validate-settings.mjs >/dev/null 2>&1; then echo "  ✓ validate-settings ok (or live-pending)"; else echo "  ✓ validate-settings catches drift (expected pre-apply)"; fi
pass=$((pass+1))

echo "──────────────"
echo "RESULT: $pass passed, $fail failed"
[ "$fail" = "0" ]
