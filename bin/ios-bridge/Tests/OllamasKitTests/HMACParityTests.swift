// Cross-language HMAC parity: the Swift mirror must reproduce, byte-for-byte,
// the canonical message and HMAC-SHA256 hex signature that the single-source JS
// signer (bin/host-bridge/hmac.mjs) produced into hmac-vectors.json.
import XCTest
import CryptoKit
@testable import OllamasKit

final class HMACParityTests: XCTestCase {
    struct VectorFile: Codable { let secret: String; let vectors: [Vector]; let kats: [Kat] }
    struct Vector: Codable {
        let method, path, body, timestamp, nonce, canonical, signature: String
    }
    struct Kat: Codable { let rfc, keyHex, dataHex, mac: String }

    func loadVectors() throws -> VectorFile {
        // Tests/OllamasKitTests/HMACParityTests.swift -> up 3 -> bin/ios-bridge
        let fixture = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("hmac-vectors.json")
        let data = try Data(contentsOf: fixture)
        return try JSONDecoder().decode(VectorFile.self, from: data)
    }

    func testCanonicalMessageMatchesFixture() throws {
        let vf = try loadVectors()
        XCTAssertFalse(vf.vectors.isEmpty)
        for v in vf.vectors {
            let canon = OllamasHMAC.canonicalMessage(
                method: v.method, path: v.path, body: v.body,
                timestamp: v.timestamp, nonce: v.nonce)
            XCTAssertEqual(canon, v.canonical, "canonical drift for \(v.method) \(v.path)")
        }
    }

    func testSignatureMatchesFixture() throws {
        let vf = try loadVectors()
        for v in vf.vectors {
            let sig = OllamasHMAC.computeSignature(
                secret: vf.secret, method: v.method, path: v.path, body: v.body,
                timestamp: v.timestamp, nonce: v.nonce)
            XCTAssertEqual(sig, v.signature, "signature drift for \(v.method) \(v.path)")
        }
    }

    func testWindowConstantMatchesJS() {
        XCTAssertEqual(OllamasHMAC.windowMs, 5 * 60 * 1000)
    }

    // CryptoKit must reproduce the RFC 4231 HMAC-SHA256 known answers byte-for-byte
    // — the same kats[] the JS test asserts, so JS, the bridge, and Swift all meet
    // one external reference.
    func testRFC4231KATsMatch() throws {
        let vf = try loadVectors()
        XCTAssertFalse(vf.kats.isEmpty)
        for k in vf.kats {
            let key = SymmetricKey(data: Data(hex: k.keyHex))
            let mac = HMAC<SHA256>.authenticationCode(for: Data(hex: k.dataHex), using: key)
            let hex = mac.map { String(format: "%02x", $0) }.joined()
            XCTAssertEqual(hex, k.mac, "HMAC KAT drift for \(k.rfc)")
        }
    }
}

private extension Data {
    /// Decode a hex string into bytes (test helper for RFC 4231 key/data inputs).
    init(hex: String) {
        var bytes = [UInt8]()
        bytes.reserveCapacity(hex.count / 2)
        var idx = hex.startIndex
        while idx < hex.endIndex {
            let next = hex.index(idx, offsetBy: 2)
            bytes.append(UInt8(hex[idx..<next], radix: 16) ?? 0)
            idx = next
        }
        self.init(bytes)
    }
}
