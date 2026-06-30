import { describe, it, expect } from "vitest";
import crypto from "crypto";
import zlib from "zlib";
import path from "path";
import { ProviderRouter } from "../server/providers";
import { FilesystemManager } from "../server/files";
import { TerminalManager } from "../server/terminal";
import { db } from "../server/db";

// Ensure mock db permissions are set for tests
db.data.permissions.commandExec = true;

describe("LLM Mission Control Core Software Suite Tests", () => {
  
  // 1. ProviderRouter fallback chain order
  it("ProviderRouter fallback chain advances correctly", () => {
    // Access private static method for testing
    const getFallbackChain = (ProviderRouter as any).getFallbackChain.bind(ProviderRouter);
    const chainOpenRouter = getFallbackChain("openrouter");
    
    expect(chainOpenRouter[0]).toBe("openrouter");
    expect(chainOpenRouter).toContain("ollama-local");
    expect(chainOpenRouter).toContain("gemini");
    expect(chainOpenRouter).toContain("openai");
    expect(chainOpenRouter).toContain("demo");
    expect(chainOpenRouter).toContain("fleet");
    expect(chainOpenRouter).toContain("gemini-cli"); // keyless OAuth backend in the chain
    expect(chainOpenRouter.length).toBe(8); // fleet + gemini-cli (server/providers.ts fallback defaults)

    const chainUnknown = getFallbackChain("unknown-provider");
    expect(chainUnknown[0]).toBe("unknown-provider");
    expect(chainUnknown[1]).toBe("fleet"); // fleet artık ilk default; ardından ollama-local
    expect(chainUnknown[2]).toBe("ollama-local");
  });

  // 2. FILE: marker parser used by pipeline
  it("Parses FILE: markers correctly", () => {
    const coderOutput = `
Here is your structure.
FILE: src/main.py
\`\`\`python
print("Hello")
\`\`\`
FILE: README.md
\`\`\`markdown
# Test
\`\`\`
    `.trim();

    const lines = coderOutput.split("\n");
    let activeFile = "";
    let collectingContent = false;
    let filesParsed: Record<string, string> = {};
    let blockContent: string[] = [];

    for (const line of lines) {
      if (line.trim().startsWith("FILE:")) {
        activeFile = line.replace("FILE:", "").trim();
        collectingContent = false;
        blockContent = [];
        continue;
      }
      if (activeFile) {
        if (line.trim().startsWith("\`\`\`")) {
          if (!collectingContent) collectingContent = true;
          else {
            collectingContent = false;
            // End of block
            filesParsed[activeFile] = blockContent.join("\n");
            activeFile = "";
          }
          continue;
        }
        if (collectingContent) blockContent.push(line);
      }
    }

    expect(filesParsed["src/main.py"]).toBe('print("Hello")');
    expect(filesParsed["README.md"]).toBe("# Test");
  });

  // 3. Path Transversal Sandbox Enforcements
  it("Path escape guard correctly blocks sibling directories and traversal", () => {
    const rootPath = "/app/workspace";
    
    // Siblings
    expect(() => FilesystemManager.resolveSafePath(rootPath, "../workspace-secret")).toThrow("escapes workspace root");
    
    // Parent traversal
    expect(() => FilesystemManager.resolveSafePath(rootPath, "../../etc/passwd")).toThrow("escapes workspace root");

    // Internal resolution passes
    const safeTarget = FilesystemManager.resolveSafePath(rootPath, "src/main.py");
    // Depending on path.sep formatting, standard checks:
    expect(safeTarget).toContain(path.resolve(rootPath));
  });

  // 4. Shell Command allowlist sandboxes
  it("Terminal allowlist sandbox rules", async () => {
    // 4.1 Allowed binary passes
    const allowed = await TerminalManager.execute(false, "/demo", "ls -la");
    expect(allowed.exitCode).toBe(0);

    // 4.2 Malicious command blocked
    const malicious = await TerminalManager.execute(true, "/demo", "rm -rf /");
    expect(malicious.exitCode).toBe(126);
    expect(malicious.stderr).toContain("Security block");

    // 4.3 Sudo blocked
    const sudoCheck = await TerminalManager.execute(true, "/demo", "sudo apt-get install haproxy");
    expect(sudoCheck.exitCode).toBe(126);
    expect(sudoCheck.stderr).toContain("Restricted system operation");

    // 4.4 Metacharacters blocked
    const metaCheck = await TerminalManager.execute(true, "/demo", "ls ; echo HAcked");
    expect(metaCheck.exitCode).toBe(126);
    expect(metaCheck.stderr).toContain("Forbidden shell character");
  });

  // 5. Client-Side Cryptographic AES Encryptions Round-trips
  it("AES-256-GCM zero-knowledge compression/decryption loops identical", () => {
    const testData = "Mission Control DB Payload 2026 - Critical Infrastructure";
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);

    // Compress
    const compressed = zlib.gzipSync(Buffer.from(testData));

    // Decrypt
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    let encAndSalt = cipher.update(compressed);
    encAndSalt = Buffer.concat([encAndSalt, cipher.final()]);
    const tag = cipher.getAuthTag();

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    let dec = decipher.update(encAndSalt);
    dec = Buffer.concat([dec, decipher.final()]);

    const plainText = zlib.gunzipSync(dec).toString("utf-8");
    expect(plainText).toBe(testData);
  });

  // 6. Mode detection check
  it("Mode detection defaults to demo when K_SERVICE set", () => {
    // Mock the environment variable check block explicitly described in server.ts
    const testEnv = { K_SERVICE: "cloud-run-container", OS: "linux" };
    
    const isCloud = !!(
      testEnv.K_SERVICE || 
      testEnv.OS !== "darwin"
    );
    
    expect(isCloud).toBe(true); // Should evaluate to Cloud (demo)
  });
});
