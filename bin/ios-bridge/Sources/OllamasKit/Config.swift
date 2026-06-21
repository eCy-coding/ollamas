// Client configuration: where the ollamas gateway lives and how to authenticate.
// Resolved from environment so the same binary works in dev (no key) and SaaS
// (Bearer key). Secret persistence (iOS Keychain) is a v9 concern — for now the
// key comes from the environment / Shortcut input, never hardcoded.
import Foundation

public struct OllamasConfig: Sendable {
    public let gateway: URL
    public let apiKey: String?

    public init(gateway: URL, apiKey: String?) {
        self.gateway = gateway
        self.apiKey = apiKey
    }

    /// Build from environment: OLLAMAS_GATEWAY (default http://127.0.0.1:3000),
    /// OLLAMAS_API_KEY (optional — omitted in dev / SAAS_ENFORCE=0).
    public static func fromEnvironment(_ env: [String: String] = ProcessInfo.processInfo.environment) -> OllamasConfig {
        let raw = env["OLLAMAS_GATEWAY"] ?? "http://127.0.0.1:3000"
        let url = URL(string: raw) ?? URL(string: "http://127.0.0.1:3000")!
        let key = env["OLLAMAS_API_KEY"].flatMap { $0.isEmpty ? nil : $0 }
        return OllamasConfig(gateway: url, apiKey: key)
    }
}
