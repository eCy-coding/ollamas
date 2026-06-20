// Pure Apple .mobileconfig (configuration profile) renderer that embeds a root CA
// so an iPhone can TRUST the mkcert-issued LAN-TLS cert (https://<mac>.local).
//
// No reliable OSS generator exists for this; we render the plist XML ourselves.
// Profile structure adopted (shape only, no source copy) from mullvad/encrypted-dns-profiles.
//
// PURE + fully unit-testable — no device, no network. The manual iOS trust step
// (Settings → General → About → Certificate Trust Settings) is documented in the recipe.

import { randomUUID } from "node:crypto";

export interface MobileConfigOptions {
  /** Certificate Common Name shown on-device, e.g. "ollamas Local CA". */
  certName: string;
  /** Reverse-DNS profile id, e.g. "com.ollamas.tunnel.lan-tls". */
  identifier: string;
  /** Human label in Settings → Profiles. */
  displayName: string;
  /** Short description shown before install. */
  description: string;
  /** Stable UUIDs (inject for deterministic tests); defaults to randomUUID(). */
  payloadUuid?: string;
  certUuid?: string;
}

/** Strip PEM armor + whitespace → raw base64 DER body (what the plist <data> needs). */
export function pemToBase64(pem: string): string {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}

/** Re-wrap base64 to 64-char lines, indented — matches Apple plist <data> formatting. */
function wrapData(b64: string, indent: string): string {
  const lines = b64.match(/.{1,64}/g) ?? [];
  return lines.map((l) => `${indent}${l}`).join("\n");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Render a complete .mobileconfig embedding `caCertPem` as a
 * com.apple.security.root payload. Result is deterministic when UUIDs are injected.
 */
export function renderMobileConfig(caCertPem: string, opts: MobileConfigOptions): string {
  const certBody = pemToBase64(caCertPem);
  if (certBody.length === 0) throw new Error("renderMobileConfig: empty/invalid CA PEM");
  const payloadUuid = opts.payloadUuid ?? randomUUID();
  const certUuid = opts.certUuid ?? randomUUID();
  const data = wrapData(certBody, "\t\t\t\t");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>PayloadContent</key>
\t<array>
\t\t<dict>
\t\t\t<key>PayloadType</key>
\t\t\t<string>com.apple.security.root</string>
\t\t\t<key>PayloadVersion</key>
\t\t\t<integer>1</integer>
\t\t\t<key>PayloadIdentifier</key>
\t\t\t<string>${escapeXml(opts.identifier)}.cert</string>
\t\t\t<key>PayloadUUID</key>
\t\t\t<string>${certUuid}</string>
\t\t\t<key>PayloadDisplayName</key>
\t\t\t<string>${escapeXml(opts.certName)}</string>
\t\t\t<key>PayloadCertificateFileName</key>
\t\t\t<string>rootCA.pem</string>
\t\t\t<key>PayloadContent</key>
\t\t\t<data>
${data}
\t\t\t</data>
\t\t</dict>
\t</array>
\t<key>PayloadType</key>
\t<string>Configuration</string>
\t<key>PayloadVersion</key>
\t<integer>1</integer>
\t<key>PayloadIdentifier</key>
\t<string>${escapeXml(opts.identifier)}</string>
\t<key>PayloadUUID</key>
\t<string>${payloadUuid}</string>
\t<key>PayloadDisplayName</key>
\t<string>${escapeXml(opts.displayName)}</string>
\t<key>PayloadDescription</key>
\t<string>${escapeXml(opts.description)}</string>
</dict>
</plist>
`;
}
