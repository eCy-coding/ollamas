#!/usr/bin/env bats
# v7 — self_heal DRY default must be side-effect-free (bats-core, MIT; core-only).

ROOT="${BATS_TEST_DIRNAME}/../../.."

@test "self_heal DRY (no --apply) exits 0 against unreachable bridge" {
  run env BRIDGE_PORT=59997 node "$ROOT/bin/host-bridge/tools/self_heal.mjs"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"applied": false'* ]]
}

@test "self_heal DRY reports a plan without executing" {
  run env BRIDGE_PORT=59997 node "$ROOT/bin/host-bridge/tools/self_heal.mjs"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"actions"'* ]]
}
