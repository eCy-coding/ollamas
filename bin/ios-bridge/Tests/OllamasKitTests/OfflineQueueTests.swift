// v9 — OfflineQueue persistence + flush/retry. Uses a temp file per test; no
// network (sender is injected). Asserts: enqueue persists, successful flush
// drains, failing flush keeps items + bumps attempts, queue survives reload.
import XCTest
@testable import OllamasKit

final class OfflineQueueTests: XCTestCase {
    var fileURL: URL!

    override func setUp() {
        super.setUp()
        fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("ollamas-q-\(UUID().uuidString).json")
    }
    override func tearDown() {
        try? FileManager.default.removeItem(at: fileURL)
        super.tearDown()
    }

    private func envelope(_ prompt: String) -> RequestEnvelope {
        let body = try? JSONSerialization.data(withJSONObject: ["messages": [["role": "user", "content": prompt]]])
        return RequestEnvelope(path: "/api/generate", method: "POST", bodyJSON: body)
    }

    func testEnqueuePersistsAndCounts() async throws {
        let q = OfflineQueue(fileURL: fileURL)
        try await q.enqueue(envelope("hi"))
        try await q.enqueue(envelope("yo"))
        let c = await q.count
        XCTAssertEqual(c, 2)
        XCTAssertTrue(FileManager.default.fileExists(atPath: fileURL.path))
    }

    func testSuccessfulFlushDrains() async throws {
        let q = OfflineQueue(fileURL: fileURL)
        try await q.enqueue(envelope("a"))
        try await q.enqueue(envelope("b"))
        var sent = 0
        let r = try await q.flush { _ in sent += 1 }
        XCTAssertEqual(sent, 2)
        XCTAssertEqual(r.delivered, 2)
        XCTAssertEqual(r.remaining, 0)
        let c = await q.count
        XCTAssertEqual(c, 0)
    }

    func testFailingFlushKeepsItemsAndBumpsAttempts() async throws {
        let q = OfflineQueue(fileURL: fileURL)
        try await q.enqueue(envelope("a"))
        struct Offline: Error {}
        let r = try await q.flush { _ in throw Offline() }
        XCTAssertEqual(r.delivered, 0)
        XCTAssertEqual(r.remaining, 1)
        let items = await q.list()
        XCTAssertEqual(items.first?.attempts, 1)
        // second failed flush bumps again
        _ = try await q.flush { _ in throw Offline() }
        let items2 = await q.list()
        XCTAssertEqual(items2.first?.attempts, 2)
    }

    func testPartialFlushRetriesOnlyFailures() async throws {
        let q = OfflineQueue(fileURL: fileURL)
        try await q.enqueue(envelope("ok"))
        try await q.enqueue(envelope("bad"))
        struct Boom: Error {}
        let r = try await q.flush { env in
            let s = String(data: env.bodyJSON ?? Data(), encoding: .utf8) ?? ""
            if s.contains("bad") { throw Boom() }
        }
        XCTAssertEqual(r.delivered, 1)
        XCTAssertEqual(r.remaining, 1)
        let items = await q.list()
        XCTAssertEqual(items.count, 1)
        XCTAssertTrue(String(data: items[0].bodyJSON ?? Data(), encoding: .utf8)!.contains("bad"))
    }

    func testPersistenceAcrossInstances() async throws {
        let q1 = OfflineQueue(fileURL: fileURL)
        try await q1.enqueue(envelope("survive"))
        // fresh instance over the same file
        let q2 = OfflineQueue(fileURL: fileURL)
        let c = await q2.count
        XCTAssertEqual(c, 1)
        let items = await q2.list()
        XCTAssertEqual(items.first?.path, "/api/generate")
    }

    func testDefaultFileURLHonorsEnv() {
        let url = OfflineQueue.defaultFileURL(["OLLAMAS_QUEUE_FILE": "/tmp/custom-outbox.json"])
        XCTAssertEqual(url.path, "/tmp/custom-outbox.json")
    }
}
