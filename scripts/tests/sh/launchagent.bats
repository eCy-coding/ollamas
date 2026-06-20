#!/usr/bin/env bats
# v16 — LaunchAgent install/uninstall are side-effect-free under DRY_RUN=1:
# launchctl + plist write are echoed, nothing is written to ~/Library/LaunchAgents,
# no real daemon is bootstrapped (bats-core, MIT; core-only assertions).

ROOT="${BATS_TEST_DIRNAME}/../../.."

setup() {
  FAKE_HOME="$(mktemp -d)"
}
teardown() {
  rm -rf "$FAKE_HOME"
}

@test "install-agent.sh DRY_RUN exits 0, echoes launchctl, writes no plist" {
  run env DRY_RUN=1 HOME="$FAKE_HOME" bash "$ROOT/bin/host-bridge/install-agent.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"[DRY]"* ]]
  [[ "$output" == *"launchctl bootstrap"* ]]
  [[ "$output" == *"kickstart"* ]]
  # no plist written under the fake LaunchAgents dir
  [ ! -f "$FAKE_HOME/Library/LaunchAgents/com.missioncontrol.terminalbridge.plist" ]
}

@test "uninstall.sh DRY_RUN echoes launchctl bootout (no real removal)" {
  run env DRY_RUN=1 HOME="$FAKE_HOME" bash "$ROOT/uninstall.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"[DRY]"* ]]
  [[ "$output" == *"bootout"* ]]
}
