// vT15: named-tunnel state — encrypted at rest (token is a secret, RISK-TUNNEL-028).
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeNamed, readNamed, describeNamed, type NamedConfig } from "./cf-named.ts";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tmp(): { vault: string; keyfile: string } {
  const dir = mkdtempSync(join(tmpdir(), "cfnamed-"));
  return { vault: join(dir, "cf-named.vault"), keyfile: join(dir, "keyfile") };
}

const tokenCfg: NamedConfig = { mode: "token", hostname: "ollamas.example.dev", token: "eyJhbG.SECRET.xyz" };
const cliCfg: NamedConfig = {
  mode: "cli",
  hostname: "ollamas.example.dev",
  tunnelId: "6ff42ae2-765d-4adf-8112-31c55c1551ef",
  credFile: "/Users/you/.cloudflared/6ff42ae2.json",
};

test("cf-named: token config roundtrips through encrypted vault", () => {
  const { vault, keyfile } = tmp();
  writeNamed(vault, keyfile, tokenCfg);
  assert.deepEqual(readNamed(vault, keyfile), tokenCfg);
});

test("cf-named: cli config roundtrips", () => {
  const { vault, keyfile } = tmp();
  writeNamed(vault, keyfile, cliCfg);
  assert.deepEqual(readNamed(vault, keyfile), cliCfg);
});

test("cf-named: token is ENCRYPTED at rest — plaintext never on disk (RISK-TUNNEL-028)", () => {
  const { vault, keyfile } = tmp();
  writeNamed(vault, keyfile, tokenCfg);
  const raw = readFileSync(vault, "utf8");
  assert.ok(!raw.includes("eyJhbG.SECRET.xyz"), "token plaintext must NOT be on disk");
});

test("cf-named: readNamed missing/corrupt → null (graceful)", () => {
  const { vault, keyfile } = tmp();
  assert.equal(readNamed(vault, keyfile), null); // never written
});

test("cf-named: describeNamed is secret-free (hostname + mode, NEVER the token)", () => {
  const d = describeNamed(tokenCfg);
  assert.match(d, /ollamas\.example\.dev/);
  assert.match(d, /token/);
  assert.ok(!d.includes("eyJhbG.SECRET.xyz"), "describe must never leak the token");
});

test("cf-named: describeNamed for cli shows tunnelId (non-secret) not credFile contents", () => {
  const d = describeNamed(cliCfg);
  assert.match(d, /ollamas\.example\.dev/);
  assert.match(d, /cli/);
});
