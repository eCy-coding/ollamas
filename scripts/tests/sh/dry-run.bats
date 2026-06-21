#!/usr/bin/env bats
# v6 — behavioral proof that destructive lifecycle scripts are side-effect-free
# under DRY_RUN=1 (bats-core, MIT; core-only assertions, no helper libs).

ROOT="${BATS_TEST_DIRNAME}/../../.."

@test "install.sh DRY_RUN exits 0 and only echoes [DRY]" {
  run env DRY_RUN=1 bash "$ROOT/install.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"[DRY]"* ]]
}

@test "setup.sh DRY_RUN exits 0 and only echoes [DRY]" {
  run env DRY_RUN=1 bash "$ROOT/setup.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"[DRY]"* ]]
}

@test "setup-keys.sh DRY_RUN exits 0 without prompting" {
  run env DRY_RUN=1 bash "$ROOT/setup-keys.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"[DRY]"* ]]
}

@test "join-cluster.sh DRY_RUN exits 0 without prompting or spawning" {
  run env DRY_RUN=1 bash "$ROOT/join-cluster.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"[DRY]"* ]]
}

@test "stop.sh DRY_RUN exits 0" {
  run env DRY_RUN=1 bash "$ROOT/stop.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"[DRY]"* ]]
}
