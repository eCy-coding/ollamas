// Offline request queue (scripts lane, v9). When the device is offline, jobs are
// queued on disk and flushed when connectivity returns. Zero external deps —
// Codable + FileManager only (mirrors the package's zero-dep policy; adopts the
// ralfebert/PersistentURLRequestQueue MIT enqueue/flush/retry shape as a pattern,
// not a dependency).
//
// iOS is consumer-only: an envelope is an app-gateway HTTP call (path + body),
// never a host-exec command.
import Foundation

/// One queued app-gateway request. `attempts` increments on each failed flush so
/// callers can cap retries / surface stuck items.
public struct RequestEnvelope: Codable, Sendable, Equatable {
    public let id: UUID
    public let createdAt: Date
    public let path: String
    public let method: String
    public let bodyJSON: Data?
    public var attempts: Int

    public init(id: UUID = UUID(), createdAt: Date = Date(), path: String,
                method: String = "POST", bodyJSON: Data? = nil, attempts: Int = 0) {
        self.id = id
        self.createdAt = createdAt
        self.path = path
        self.method = method
        self.bodyJSON = bodyJSON
        self.attempts = attempts
    }
}

/// Disk-backed FIFO queue, serialized through an actor for thread safety.
public actor OfflineQueue {
    private let fileURL: URL
    private var items: [RequestEnvelope]

    /// Default store: OLLAMAS_QUEUE_FILE, else ~/.llm-mission-control/ios-outbox.json.
    public static func defaultFileURL(_ env: [String: String] = ProcessInfo.processInfo.environment) -> URL {
        if let p = env["OLLAMAS_QUEUE_FILE"], !p.isEmpty { return URL(fileURLWithPath: p) }
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".llm-mission-control/ios-outbox.json")
    }

    public init(fileURL: URL = OfflineQueue.defaultFileURL()) {
        self.fileURL = fileURL
        self.items = Self.load(fileURL)
    }

    public var count: Int { items.count }
    public func list() -> [RequestEnvelope] { items }

    /// Append a request and persist immediately (survives process restart).
    public func enqueue(_ envelope: RequestEnvelope) throws {
        items.append(envelope)
        try persist()
    }

    /// Drain the queue through `sender`. A delivered item is removed; a failing
    /// item stays (attempts incremented) so the next flush retries it. Order is
    /// preserved; one failure does not block later items from being attempted.
    /// Returns (delivered, remaining).
    @discardableResult
    public func flush(_ sender: (RequestEnvelope) async throws -> Void) async throws -> (delivered: Int, remaining: Int) {
        var kept: [RequestEnvelope] = []
        var delivered = 0
        for var item in items {
            do {
                try await sender(item)
                delivered += 1
            } catch {
                item.attempts += 1
                kept.append(item)
            }
        }
        items = kept
        try persist()
        return (delivered, kept.count)
    }

    // MARK: - persistence (atomic)

    private func persist() throws {
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        let data = try enc.encode(items)
        try data.write(to: fileURL, options: .atomic)
    }

    private static func load(_ url: URL) -> [RequestEnvelope] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        return (try? dec.decode([RequestEnvelope].self, from: data)) ?? []
    }
}
