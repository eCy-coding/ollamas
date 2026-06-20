// swift-tools-version:5.9
// OllamasKit — iOS/macOS consumer client for the ollamas app API (HTTP/MCP).
// iOS is a consumer-only surface: it talks to the app server (Bearer API key),
// NOT the host terminal bridge (127.0.0.1-only, host-exec, unreachable from a
// device). CryptoKit/Foundation only — zero external dependencies.
import PackageDescription

let package = Package(
    name: "OllamasKit",
    platforms: [.macOS(.v13), .iOS(.v16)],
    products: [
        .library(name: "OllamasKit", targets: ["OllamasKit"]),
        .executable(name: "ollamas-ios", targets: ["ollamas-ios"]),
    ],
    targets: [
        .target(name: "OllamasKit"),
        .executableTarget(name: "ollamas-ios", dependencies: ["OllamasKit"]),
        .testTarget(name: "OllamasKitTests", dependencies: ["OllamasKit"]),
    ]
)
