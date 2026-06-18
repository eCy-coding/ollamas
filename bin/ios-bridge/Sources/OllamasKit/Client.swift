// Thin async HTTP client for the ollamas app API. Never imports server code —
// it only speaks the public HTTP contract (clig.dev / MCP). Endpoints:
//   GET  /api/health           (no auth)
//   POST /api/generate         {provider?,model?,messages|prompt,temperature?,stream?}
//   POST /mcp                  JSON-RPC 2.0 (tools/list, tools/call)
// Bearer auth header is attached only when an API key is configured.
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct OllamasClient: Sendable {
    public let config: OllamasConfig
    private let session: URLSession

    public init(config: OllamasConfig = .fromEnvironment(), session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    // MARK: - Request building (pure, unit-testable without network)

    /// Build a request against the gateway. Adds Bearer auth when a key exists
    /// and a JSON content-type when a body is present.
    public func buildRequest(path: String, method: String = "GET", jsonBody: Data? = nil) -> URLRequest {
        var req = URLRequest(url: config.gateway.appendingPathComponent(path.hasPrefix("/") ? String(path.dropFirst()) : path))
        req.httpMethod = method
        if let body = jsonBody {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let key = config.apiKey {
            req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        }
        return req
    }

    /// JSON-RPC 2.0 envelope for the /mcp endpoint.
    public static func mcpEnvelope(id: Int, method: String, params: [String: Any]) -> Data {
        let obj: [String: Any] = ["jsonrpc": "2.0", "id": id, "method": method, "params": params]
        return (try? JSONSerialization.data(withJSONObject: obj)) ?? Data()
    }

    /// Body for POST /api/generate (single-prompt convenience).
    public static func generateBody(prompt: String, provider: String?, model: String?,
                                    temperature: Double?, stream: Bool) -> Data {
        var obj: [String: Any] = [
            "messages": [["role": "user", "content": prompt]],
            "stream": stream,
        ]
        if let provider { obj["provider"] = provider }
        if let model { obj["model"] = model }
        if let temperature { obj["temperature"] = temperature }
        return (try? JSONSerialization.data(withJSONObject: obj)) ?? Data()
    }

    // MARK: - Network calls

    private func send(_ req: URLRequest) async throws -> Data {
        let (data, resp) = try await session.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw OllamasError.http(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        return data
    }

    public func health() async throws -> Data {
        try await send(buildRequest(path: "/api/health"))
    }

    public func generate(prompt: String, provider: String? = nil, model: String? = nil,
                         temperature: Double? = nil) async throws -> Data {
        let body = Self.generateBody(prompt: prompt, provider: provider, model: model,
                                     temperature: temperature, stream: false)
        return try await send(buildRequest(path: "/api/generate", method: "POST", jsonBody: body))
    }

    public func mcpToolsList() async throws -> Data {
        let body = Self.mcpEnvelope(id: 1, method: "tools/list", params: [:])
        return try await send(buildRequest(path: "/mcp", method: "POST", jsonBody: body))
    }

    public func mcpCall(name: String, arguments: [String: Any]) async throws -> Data {
        let body = Self.mcpEnvelope(id: 2, method: "tools/call",
                                    params: ["name": name, "arguments": arguments])
        return try await send(buildRequest(path: "/mcp", method: "POST", jsonBody: body))
    }
}

public enum OllamasError: Error, CustomStringConvertible {
    case http(status: Int, body: String)

    public var description: String {
        switch self {
        case let .http(status, body): return "HTTP \(status): \(body)"
        }
    }
}
