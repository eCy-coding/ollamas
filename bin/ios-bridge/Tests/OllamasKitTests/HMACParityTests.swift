// Cross-language HMAC parity: the Swift mirror must reproduce, byte-for-byte,
// the canonical message and HMAC-SHA256 hex signature that the single-source JS
// signer (bin/host-bridge/hmac.mjs) produced into hmac-vectors.json.
import XCTest
@testable import OllamasKit

final class HMACParityTests: XCTestCase {
    struct VectorFile: Codable { let secret: String; let vectors: [Vector] }
    struct Vector: Codable {
        let method, path, body, timestamp, nonce, canonical, signature: String
    }

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
}
