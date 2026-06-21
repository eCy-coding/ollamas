// ollamas-ios — thin macOS/iOS CLI over OllamasKit. Talks to the app gateway
// (OLLAMAS_GATEWAY / OLLAMAS_API_KEY env). Usage:
//   ollamas-ios health
//   ollamas-ios generate "<prompt>"
//   ollamas-ios tools
//   ollamas-ios queue add "<prompt>"   (enqueue offline; OLLAMAS_QUEUE_FILE)
//   ollamas-ios queue list             (pending envelopes as JSON)
//   ollamas-ios queue flush            (deliver pending; failures stay, retry next)
import Foundation
import OllamasKit

func printData(_ data: Data) {
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write(Data("error: \(msg)\n".utf8))
    exit(1)
}

// queue add|list|flush — offline outbox over the app gateway (consumer-only).
func runQueue(_ qargs: [String], client: OllamasClient) async throws {
    let q = OfflineQueue()
    switch qargs.first {
    case "add":
        guard qargs.count >= 2 else { fail("usage: ollamas-ios queue add \"<prompt>\"") }
        let body = OllamasClient.generateBody(prompt: qargs[1], provider: nil, model: nil, temperature: nil, stream: false)
        try await q.enqueue(RequestEnvelope(path: "/api/generate", method: "POST", bodyJSON: body))
        let c = await q.count
        printData(Data("{\"ok\":true,\"queued\":true,\"pending\":\(c)}".utf8))
    case "list":
        let items = await q.list()
        let arr = items.map { e -> [String: Any] in
            ["id": e.id.uuidString, "path": e.path, "method": e.method, "attempts": e.attempts,
             "createdAt": ISO8601DateFormatter().string(from: e.createdAt)]
        }
        printData((try? JSONSerialization.data(withJSONObject: arr, options: .prettyPrinted)) ?? Data("[]".utf8))
    case "flush":
        let r = try await q.flush { env in
            _ = try await client.sendEnvelope(path: env.path, method: env.method, body: env.bodyJSON)
        }
        printData(Data("{\"ok\":true,\"delivered\":\(r.delivered),\"remaining\":\(r.remaining)}".utf8))
    default:
        fail("usage: ollamas-ios queue <add \"<prompt>\"|list|flush>")
    }
}

let args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first else {
    fail("usage: ollamas-ios <health|generate \"<prompt>\"|tools|queue>")
}

let client = OllamasClient()

// Top-level await is not available in an executable's main.swift target here,
// so drive the async calls through a semaphore.
let sema = DispatchSemaphore(value: 0)
Task {
    do {
        switch cmd {
        case "health":
            printData(try await client.health())
        case "generate":
            guard args.count >= 2 else { fail("usage: ollamas-ios generate \"<prompt>\"") }
            printData(try await client.generate(prompt: args[1]))
        case "tools":
            printData(try await client.mcpToolsList())
        case "queue":
            try await runQueue(Array(args.dropFirst()), client: client)
        default:
            fail("unknown command '\(cmd)' (health|generate|tools|queue)")
        }
    } catch {
        FileHandle.standardError.write(Data("error: \(error)\n".utf8))
        sema.signal()
        exit(1)
    }
    sema.signal()
}
sema.wait()
