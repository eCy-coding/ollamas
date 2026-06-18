// ollamas-ios — thin macOS/iOS CLI over OllamasKit. Talks to the app gateway
// (OLLAMAS_GATEWAY / OLLAMAS_API_KEY env). Usage:
//   ollamas-ios health
//   ollamas-ios generate "<prompt>"
//   ollamas-ios tools
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

let args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first else {
    fail("usage: ollamas-ios <health|generate \"<prompt>\"|tools>")
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
        default:
            fail("unknown command '\(cmd)' (health|generate|tools)")
        }
    } catch {
        FileHandle.standardError.write(Data("error: \(error)\n".utf8))
        sema.signal()
        exit(1)
    }
    sema.signal()
}
sema.wait()
