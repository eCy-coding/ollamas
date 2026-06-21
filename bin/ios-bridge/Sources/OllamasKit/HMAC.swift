// HMAC-SHA256 canonical signing — Swift mirror of bin/host-bridge/hmac.mjs and
// server/bridge-hmac.ts. The canonical message MUST stay byte-identical across
// all three so a signature made on any side verifies on the others. This is the
// THIRD mirror (JS server, JS bridge, Swift). iOS does not currently sign app
// API requests (those use a Bearer key), but this keeps the door open for an
// HMAC-protected endpoint and is guarded by cross-language vector tests.
import Foundation
import CryptoKit

public enum OllamasHMAC {
    /// 5-minute freshness window, matching HMAC_WINDOW_MS on the JS side.
    public static let windowMs = 5 * 60 * 1000

    /// Canonical signed message — KEEP IDENTICAL to hmac.mjs canonicalMessage.
    /// Format: METHOD\nPATH\nBODY\nTIMESTAMP\nNONCE (uppercase method).
    public static func canonicalMessage(method: String, path: String, body: String,
                                        timestamp: String, nonce: String) -> String {
        return "\(method.uppercased())\n\(path)\n\(body)\n\(timestamp)\n\(nonce)"
    }

    /// HMAC-SHA256 hex signature over the canonical message (UTF-8).
    public static func computeSignature(secret: String, method: String, path: String,
                                        body: String, timestamp: String, nonce: String) -> String {
        let key = SymmetricKey(data: Data(secret.utf8))
        let msg = Data(canonicalMessage(method: method, path: path, body: body,
                                        timestamp: timestamp, nonce: nonce).utf8)
        let mac = HMAC<SHA256>.authenticationCode(for: msg, using: key)
        return mac.map { String(format: "%02x", $0) }.joined()
    }
}
