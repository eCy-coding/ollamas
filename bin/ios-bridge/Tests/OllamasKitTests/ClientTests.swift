// Request-building unit tests for OllamasClient — pure, no network. Asserts URL
// composition, Bearer auth presence/absence, and the JSON body shapes for
// /api/generate and the /mcp JSON-RPC envelope.
import XCTest
@testable import OllamasKit

final class ClientTests: XCTestCase {
    let gateway = URL(string: "http://127.0.0.1:3000")!

    func clientWithKey(_ key: String?) -> OllamasClient {
        OllamasClient(config: OllamasConfig(gateway: gateway, apiKey: key))
    }

    func testBuildRequestComposesUrlAndMethod() {
        let req = clientWithKey(nil).buildRequest(path: "/api/health")
        XCTAssertEqual(req.url?.absoluteString, "http://127.0.0.1:3000/api/health")
        XCTAssertEqual(req.httpMethod, "GET")
        XCTAssertNil(req.value(forHTTPHeaderField: "Authorization"))
    }

    func testBearerHeaderAttachedOnlyWithKey() {
        let withKey = clientWithKey("olm_secret").buildRequest(path: "/mcp", method: "POST", jsonBody: Data("{}".utf8))
        XCTAssertEqual(withKey.value(forHTTPHeaderField: "Authorization"), "Bearer olm_secret")
        XCTAssertEqual(withKey.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(withKey.httpMethod, "POST")

        let noKey = clientWithKey(nil).buildRequest(path: "/mcp", method: "POST", jsonBody: Data("{}".utf8))
        XCTAssertNil(noKey.value(forHTTPHeaderField: "Authorization"))
    }

    func testMcpEnvelopeShape() throws {
        let data = OllamasClient.mcpEnvelope(id: 7, method: "tools/call",
                                             params: ["name": "read_file", "arguments": ["path": "README.md"]])
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(obj["jsonrpc"] as? String, "2.0")
        XCTAssertEqual(obj["id"] as? Int, 7)
        XCTAssertEqual(obj["method"] as? String, "tools/call")
        let params = try XCTUnwrap(obj["params"] as? [String: Any])
        XCTAssertEqual(params["name"] as? String, "read_file")
    }

    func testGenerateBodyShape() throws {
        let data = OllamasClient.generateBody(prompt: "hi", provider: "ollama",
                                              model: "qwen3:8b", temperature: 0.2, stream: false)
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(obj["provider"] as? String, "ollama")
        XCTAssertEqual(obj["model"] as? String, "qwen3:8b")
        XCTAssertEqual(obj["stream"] as? Bool, false)
        let messages = try XCTUnwrap(obj["messages"] as? [[String: Any]])
        XCTAssertEqual(messages.first?["role"] as? String, "user")
        XCTAssertEqual(messages.first?["content"] as? String, "hi")
    }

    func testConfigFromEnvironmentDefaultsAndKey() {
        let dev = OllamasConfig.fromEnvironment([:])
        XCTAssertEqual(dev.gateway.absoluteString, "http://127.0.0.1:3000")
        XCTAssertNil(dev.apiKey)

        let saas = OllamasConfig.fromEnvironment(["OLLAMAS_GATEWAY": "https://gw.example:8443", "OLLAMAS_API_KEY": "olm_x"])
        XCTAssertEqual(saas.gateway.absoluteString, "https://gw.example:8443")
        XCTAssertEqual(saas.apiKey, "olm_x")
    }
}
