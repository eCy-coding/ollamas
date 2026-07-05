---
description: Check the project's Homebrew/macOS dependencies against the root Brewfile — present/missing per tier (core-missing blocks, else warns). --install runs `brew bundle` (opt-in, system mutation).
allowed-tools: Bash(./node_modules/.bin/tsx orchestration/bin/deps-doctor.ts:*), Bash(npx tsx orchestration/bin/deps-doctor.ts:*), Bash(brew bundle:*), Bash(brew install:*)
argument-hint: "[--json | --install]"
---
Run `./node_modules/.bin/tsx orchestration/bin/deps-doctor.ts $ARGUMENTS`.

Parses the root `Brewfile` (tiers: core/dev/asset/tunnel/packaging/ai/cask), probes each with `command -v`,
and reports `present X/total` + missing per tier → `orchestration/DEPS_DOCTOR.md`. A missing **core** dep
blocks (exit 1); dev/lane-optional missing just warn with the `brew install` hint. `--install` = `brew bundle`
(installs everything, idempotent — system mutation, operator/T0). node = mise, git/curl = Xcode CLT
(external-managed, not in the Brewfile); macOS built-ins need only the Automation/TCC grant (host-bridge).
Report present/total + any missing. Also surfaced in `ollamas ready`.
