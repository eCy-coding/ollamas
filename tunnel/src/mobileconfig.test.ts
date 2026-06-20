import test from "node:test";
import assert from "node:assert/strict";
import { renderMobileConfig, pemToBase64 } from "./mobileconfig.ts";

const FAKE_PEM = `-----BEGIN CERTIFICATE-----
TUlJQ2Z6Q0NBV2VnQXdJQkFnSVF
RkFLRT0=
-----END CERTIFICATE-----`;

const opts = {
  certName: "ollamas Local CA",
  identifier: "com.ollamas.tunnel.lan-tls",
  displayName: "ollamas LAN-TLS",
  description: "Trust the ollamas local CA",
  payloadUuid: "11111111-1111-1111-1111-111111111111",
  certUuid: "22222222-2222-2222-2222-222222222222",
};

test("pemToBase64 strips armor + whitespace", () => {
  assert.equal(pemToBase64(FAKE_PEM), "TUlJQ2Z6Q0NBV2VnQXdJQkFnSVFRkFLRT0=");
});

test("renders valid plist with root cert payload", () => {
  const c = renderMobileConfig(FAKE_PEM, opts);
  assert.match(c, /<!DOCTYPE plist/);
  assert.match(c, /<string>com\.apple\.security\.root<\/string>/);
  assert.match(c, /<string>Configuration<\/string>/);
  assert.match(c, /<string>ollamas Local CA<\/string>/);
});

test("embeds injected UUIDs (deterministic)", () => {
  const c = renderMobileConfig(FAKE_PEM, opts);
  assert.match(c, /11111111-1111-1111-1111-111111111111/);
  assert.match(c, /22222222-2222-2222-2222-222222222222/);
});

test("cert payload identifier is suffixed .cert", () => {
  const c = renderMobileConfig(FAKE_PEM, opts);
  assert.match(c, /<string>com\.ollamas\.tunnel\.lan-tls\.cert<\/string>/);
});

test("data block contains the base64 cert body", () => {
  const c = renderMobileConfig(FAKE_PEM, opts);
  assert.match(c, /TUlJQ2Z6Q0NBV2VnQXdJQkFnSVFRkFLRT0=/);
});

test("throws on empty/invalid PEM", () => {
  assert.throws(() => renderMobileConfig("-----BEGIN CERTIFICATE----------END CERTIFICATE-----", opts), /empty\/invalid/);
});

test("escapes XML special chars in display name", () => {
  const c = renderMobileConfig(FAKE_PEM, { ...opts, displayName: "a & b <c>" });
  assert.match(c, /a &amp; b &lt;c&gt;/);
  assert.doesNotMatch(c, /a & b <c>/);
});
