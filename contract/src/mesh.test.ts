import { test } from "node:test";
import assert from "node:assert/strict";
import { detectMeshHost } from "./mesh.ts";

const OK_EXEC = () => "100.64.0.7\n";

test("tailscale ip -4 → private mesh IP returned", () => {
  assert.equal(detectMeshHost({ exec: () => "100.64.0.7\nfd7a::1\n" }), "100.64.0.7");
  assert.equal(detectMeshHost({ exec: () => "  10.0.0.5  " }), "10.0.0.5");
});

test("public tailscale output → rejected → falls through", () => {
  const prev = process.env.CONTRACT_RPC_HOST;
  delete process.env.CONTRACT_RPC_HOST;
  try {
    assert.equal(detectMeshHost({ exec: () => "8.8.8.8\n" }), undefined);
  } finally {
    if (prev !== undefined) process.env.CONTRACT_RPC_HOST = prev;
  }
});

test("tailscale absent (throws) → CONTRACT_RPC_HOST fallback when private", () => {
  const prev = process.env.CONTRACT_RPC_HOST;
  process.env.CONTRACT_RPC_HOST = "192.168.1.9";
  try {
    assert.equal(detectMeshHost({ exec: () => { throw new Error("not found"); } }), "192.168.1.9");
  } finally {
    if (prev === undefined) delete process.env.CONTRACT_RPC_HOST;
    else process.env.CONTRACT_RPC_HOST = prev;
  }
});

test("env fallback rejected when public; no source → undefined", () => {
  const prev = process.env.CONTRACT_RPC_HOST;
  process.env.CONTRACT_RPC_HOST = "104.16.1.1"; // public
  try {
    assert.equal(detectMeshHost({ exec: () => { throw new Error("x"); } }), undefined);
  } finally {
    if (prev === undefined) delete process.env.CONTRACT_RPC_HOST;
    else process.env.CONTRACT_RPC_HOST = prev;
  }
});

test("empty tailscale output → falls through", () => {
  const prev = process.env.CONTRACT_RPC_HOST;
  delete process.env.CONTRACT_RPC_HOST;
  try {
    assert.equal(detectMeshHost({ exec: () => "\n\n" }), undefined);
  } finally {
    if (prev !== undefined) process.env.CONTRACT_RPC_HOST = prev;
  }
  assert.equal(typeof OK_EXEC(), "string");
});
