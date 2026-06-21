#!/usr/bin/env bats
# v8 — seyir_stats runs against an empty/missing stream without error (bats-core, MIT).

ROOT="${BATS_TEST_DIRNAME}/../../.."

@test "seyir_stats --json on empty stream exits 0" {
  TMP="$(mktemp -d)"
  run env MISSION_CONTROL_DATA_DIR="$TMP" node "$ROOT/bin/host-bridge/tools/seyir_stats.mjs" --json
  rm -rf "$TMP"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"total": 0'* ]]
}

@test "seyir_stats terminal dashboard renders header" {
  TMP="$(mktemp -d)"
  run env MISSION_CONTROL_DATA_DIR="$TMP" node "$ROOT/bin/host-bridge/tools/seyir_stats.mjs"
  rm -rf "$TMP"
  [ "$status" -eq 0 ]
  [[ "$output" == *"seyir-defteri"* ]]
}
