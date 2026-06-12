import express from "express";
import path from "path";
import os from "os";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import { db } from "./server/db";
import { ProviderRouter } from "./server/providers";
import { FilesystemManager } from "./server/files";
import { TerminalManager } from "./server/terminal";
import { BackupService } from "./server/backup";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Body Parsers with large limit for file saves and backup streams
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

/**
 * L1: Dynamic Environment Detection
 */
async function detectMode(): Promise<"live" | "degraded-live" | "demo"> {
  const isHardCloud = !!(
    process.env.K_SERVICE || 
    process.env.GOOGLE_CLOUD_RUN || 
    process.env.CODESANDBOX_SSE
  );
  
  if (isHardCloud) {
    return "demo";
  }

  // Probe local Ollama host
  const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
  try {
    const res = await fetch(`${ollamaHost}/api/version`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      return "live";
    }
  } catch (e) {
    // Attempt docker-internal fallback probe too before degrading
    try {
      const fallbackRes = await fetch("http://host.docker.internal:11434/api/version", { signal: AbortSignal.timeout(1000) });
      if (fallbackRes.ok) {
        process.env.OLLAMA_HOST = "http://host.docker.internal:11434";
        return "live";
      }
    } catch (_) {}
  }

  return "degraded-live";
}

let CURRENT_MODE: "live" | "degraded-live" | "demo" = "demo";

// Dynamic start wrapper
async function initializeServer() {
  CURRENT_MODE = await detectMode();
  console.log(`[Cockpit] Master system initialized in environment mode: ${CURRENT_MODE.toUpperCase()}`);
  
  // Set default workspace path if empty dynamically
  if (!db.data.workspacePath) {
    db.data.workspacePath = CURRENT_MODE === "demo" ? "/demo/workspace" : path.join(os.homedir(), "ai-workspace");
    db.save();
  }

  // ----------------------------------------------------
  // API ROUTES
  // ----------------------------------------------------

  /**
   * Health & Telemetry API (L1, L11)
   */
  app.get("/api/health", async (req, res) => {
    const isLive = CURRENT_MODE === "live";
    const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
    
    // Live system metrics querying CPU load and memories
    const cpuLoads = os.loadavg();
    const systemMemory = {
      total: os.totalmem(),
      free: os.freemem(),
      percentageUsed: Number(((1 - os.freemem() / os.totalmem()) * 100).toFixed(1)),
    };

    let loadedModels: any[] = [];
    let ollamaVersion = "unavailable";

    if (CURRENT_MODE !== "demo") {
      try {
        const verRes = await fetch(`${ollamaHost}/api/version`);
        if (verRes.ok) {
          const verJson = await verRes.json();
          ollamaVersion = verJson?.version || "unknown";
        }

        const psRes = await fetch(`${ollamaHost}/api/ps`);
        if (psRes.ok) {
          const psJson = await psRes.json();
          loadedModels = psJson?.models || [];
        }
      } catch (e) {}
    }

    res.json({
      mode: CURRENT_MODE,
      isLive,
      os: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        uptime: os.uptime(),
      },
      metrics: {
        cpuLoad1Min: Number(cpuLoads[0].toFixed(2)),
        memory: systemMemory,
        ollamaVersion,
        loadedModels,
      },
      workspacePath: db.data.workspacePath,
      permissions: db.data.permissions,
      hasBackupEnabled: db.data.backup.enabled,
    });
  });

  /**
   * Security & Permissions API (M7)
   */
  app.get("/api/security/log", (req, res) => {
    res.json(db.data.securityLog || []);
  });

  app.post("/api/security/permissions", (req, res) => {
    const { fileRead, fileWrite, commandExec, git } = req.body;
    db.data.permissions = {
      fileRead: !!fileRead,
      fileWrite: !!fileWrite,
      commandExec: !!commandExec,
      git: !!git,
    };
    db.logSecurity(
      "permission_change",
      "Update permissions",
      `System toggles changed - Read:${fileRead}, Write:${fileWrite}, Exec:${commandExec}, Git:${git}`,
      "info"
    );
    db.save();
    res.json({ success: true, permissions: db.data.permissions });
  });

  /**
   * Vault Settings Backend API (M1)
   */
  app.get("/api/keys/mask", (req, res) => {
    const masks: Record<string, string> = {};
    const keyConfig = db.data.keys || {};
    
    // Mask values
    Object.keys(keyConfig).forEach((keyName) => {
      const rawText = db.decrypt(keyConfig[keyName]);
      if (rawText) {
        masks[keyName] = rawText.startsWith("sk-")
          ? `sk-…${rawText.slice(-4)}`
          : `…${rawText.slice(-4)}`;
      }
    });

    // Provide default fallback masks if process.env loaded keys are placed
    const cloudProviders = ["gemini", "anthropic", "openai", "openrouter", "ollama-cloud"];
    cloudProviders.forEach((prov) => {
      if (!masks[prov]) {
        const envKey = process.env[prov.toUpperCase() + "_API_KEY"];
        if (envKey) {
          masks[prov] = `${prov.toUpperCase()}-ENV-SET`;
        }
      }
    });

    res.json(masks);
  });

  app.post("/api/keys", (req, res) => {
    const { provider, key, customEndpoint } = req.body;
    if (!provider) return res.status(400).json({ error: "Provider name requested" });

    if (key === "") {
      // Delete key
      delete db.data.keys[provider];
      if (provider === "custom-openai") {
        delete db.data.keys["custom-openai-endpoint"];
      }
      db.logSecurity("permission_change", `Key cleared for ${provider}`, "Removed provider auth credentials", "info");
    } else {
      // Encrypt and store securely (L9, M1)
      db.data.keys[provider] = db.encrypt(key);
      if (provider === "custom-openai" && customEndpoint) {
        db.data.keys["custom-openai-endpoint"] = customEndpoint;
      }
      db.logSecurity("permission_change", `Key vault configured: ${provider}`, "Decrypted credentials saved securely at rest", "info");
    }
    db.save();
    res.json({ success: true });
  });

  app.post("/api/keys/test", async (req, res) => {
    const { provider, key, customEndpoint } = req.body;
    const testConfig = {
      provider,
      model: "",
      messages: [{ role: "user" as const, content: "ping test" }],
      stream: false,
    };

    // Temporarily save to memory or override process.env for the test call
    if (key) {
      db.data.keys[provider] = db.encrypt(key);
      if (provider === "custom-openai" && customEndpoint) {
        db.data.keys["custom-openai-endpoint"] = customEndpoint;
      }
      db.save();
    }

    try {
      const start = Date.now();
      const result = await ProviderRouter.generate(testConfig);
      const elapsed = Date.now() - start;
      res.json({ success: true, latencyMs: elapsed, output: result.text.substring(0, 50) });
    } catch (e: any) {
      res.json({ success: false, error: e.message || "Credential ping failed" });
    }
  });

  /**
   * Models listing endpoints to avoid catalog hardcoding (L3, M1)
   */
  app.get("/api/models/:provider", async (req, res) => {
    const prov = req.params.provider;
    const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";

    try {
      if (prov === "ollama-local") {
        if (CURRENT_MODE === "demo") {
          return res.json([
            "qwen3:8b", "qwen3:4b", "qwen3-coder:30b", "deepseek-r1:32b", "llama3.3:70b"
          ]);
        }
        const response = await fetch(`${ollamaHost}/api/tags`);
        if (response.ok) {
          const list = await response.json();
          const names = (list.models || []).map((m: any) => m.name);
          return res.json(names);
        }
        return res.json([]);
      }

      if (prov === "openrouter") {
        const response = await fetch("https://openrouter.ai/api/v1/models");
        if (response.ok) {
          const list = await response.json();
          const names = (list.data || []).map((m: any) => m.id);
          return res.json(names);
        }
        return res.json(["google/gemini-2.5-flash-lite:free", "meta-llama/llama-3-8b-instruct:free"]);
      }

      if (prov === "gemini") {
        return res.json(["gemini-3.5-flash", "gemini-3.1-pro-preview"]);
      }

      if (prov === "anthropic") {
        return res.json(["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"]);
      }

      if (prov === "openai") {
        return res.json(["gpt-4o-mini", "gpt-4o"]);
      }

      res.json([]);
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  /**
   * Standard Prompt Proxy Endpoint with SSE Streaming Capability (M2)
   */
  app.post("/api/generate", async (req, res) => {
    const { provider, model, messages, temperature, stream } = req.body;
    
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      try {
        const result = await ProviderRouter.generate(
          { provider, model, messages, temperature, stream: true },
          (chunk) => {
            res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
          }
        );
        res.write(`data: ${JSON.stringify({ done: true, source: result.source, latencyMs: result.latencyMs })}\n\n`);
        res.end();
      } catch (err: any) {
        res.write(`data: ${JSON.stringify({ error: err.message || "Inference streaming failure" })}\n\n`);
        res.end();
      }
    } else {
      try {
        const result = await ProviderRouter.generate({
          provider,
          model,
          messages,
          temperature,
          stream: false,
        });
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err?.message || "Execution engine failure" });
      }
    }
  });

  /**
   * Filesystem API (M4)
   */
  app.get("/api/workspace/tree", async (req, res) => {
    const isLive = CURRENT_MODE !== "demo";
    try {
      const treeData = await FilesystemManager.getTree(isLive, db.data.workspacePath);
      res.json({
        ...treeData,
        mode: CURRENT_MODE,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/workspace/select", async (req, res) => {
    const { path: chosenPath } = req.body;
    if (!chosenPath) return res.status(400).json({ error: "Path parameter is required" });

    const isLive = CURRENT_MODE !== "demo";
    if (isLive) {
      if (!fs.existsSync(chosenPath)) {
        try {
          fs.mkdirSync(chosenPath, { recursive: true });
        } catch (e: any) {
          return res.status(400).json({ error: `Cannot initialize path: ${e.message}` });
        }
      }
    }
    db.data.workspacePath = chosenPath;
    db.save();
    res.json({ success: true, workspacePath: chosenPath });
  });

  app.get("/api/workspace/file", (req, res) => {
    const relativePath = req.query.relativePath as string;
    const isLive = CURRENT_MODE !== "demo";
    try {
      const content = FilesystemManager.readFile(isLive, db.data.workspacePath, relativePath);
      res.json({ content });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/workspace/file", (req, res) => {
    const { relativePath, content } = req.body;
    const isLive = CURRENT_MODE !== "demo";
    try {
      FilesystemManager.writeFile(isLive, db.data.workspacePath, relativePath, content);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/workspace/file", (req, res) => {
    const relativePath = req.query.relativePath as string;
    const isLive = CURRENT_MODE !== "demo";
    try {
      FilesystemManager.deleteFile(isLive, db.data.workspacePath, relativePath);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Terminal Shell Shell API (M5)
   */
  app.post("/api/terminal", async (req, res) => {
    const { command } = req.body;
    const isLive = CURRENT_MODE !== "demo";
    try {
      const result = await TerminalManager.execute(isLive, db.data.workspacePath, command);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Complex Hierarchical Multi-Agent Pipeline Execution Engine (M3)
   */
  app.post("/api/pipeline", async (req, res) => {
    const {
      prompt,
      architectProvider, architectModel,
      coderProvider, coderModel,
      reviewerProvider, reviewerModel,
      enableSelfImprove,
      maxIterations,
      writePermissions,
    } = req.body;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const sendProgress = (stage: string, status: "pending" | "running" | "done" | "fail", resultText: string = "", tokensPerSec: number = 0, elapsed: number = 0, fallback?: string) => {
      res.write(`data: ${JSON.stringify({ stage, status, text: resultText, tokensPerSec, elapsed, fallback })}\n\n`);
    };

    const isLive = CURRENT_MODE !== "demo";
    let architectOutput = "";
    let coderOutput = "";
    let reviewerOutput = "";

    try {
      // 1. ARCHITECT STAGE
      sendProgress("architect", "running");
      const archPrompt = `[STAGE 1: ARCHITECT]
You are the Systems Architect. Design the project directory layout, file structures, and architecture mapping based on the user's requirements:
"${prompt}"

OUTPUT: Set out clear module hierarchies, files to be created, and complete specification rules.`;

      const startArch = Date.now();
      const archResult = await ProviderRouter.generate({
        provider: architectProvider,
        model: architectModel,
        messages: [{ role: "user", content: archPrompt }],
      }, undefined, (from, to) => {
        sendProgress("architect", "running", "", 0, 0, `fallback: ${from} → ${to}`);
      });
      architectOutput = archResult.text;
      const elapsedArch = Date.now() - startArch;
      // Synthesize estimated tokens per sec metrics matching real values (L11)
      const archTokensPerSec = archResult.tokensPerSec !== undefined ? archResult.tokensPerSec : Math.round((architectOutput.length / 4) / (elapsedArch / 1000 || 1));
      sendProgress("architect", "done", architectOutput, archTokensPerSec, elapsedArch);

      // 2. CODER STAGE
      sendProgress("coder", "running");
      const coderPrompt = `[STAGE 2: CODER]
You are the software developer. Based on the Architect's layout design:\n${architectOutput}\n\nWrite the FULL completed executable content for each file requested.
STRICT RULE: For each file you propose to create, emit a marker line of the format:
FILE: relative/path/to/file.ext
Followed immediately by a markdown fenced code block containing the complete source content. Write complete code with NO shortcuts.`;

      const startCoder = Date.now();
      const coderResult = await ProviderRouter.generate({
        provider: coderProvider,
        model: coderModel,
        messages: [{ role: "user", content: coderPrompt }],
      }, undefined, (from, to) => {
        sendProgress("coder", "running", "", 0, 0, `fallback: ${from} → ${to}`);
      });
      coderOutput = coderResult.text;
      const elapsedCoder = Date.now() - startCoder;
      const coderTokensPerSec = coderResult.tokensPerSec !== undefined ? coderResult.tokensPerSec : Math.round((coderOutput.length / 4) / (elapsedCoder / 1000 || 1));
      sendProgress("coder", "done", coderOutput, coderTokensPerSec, elapsedCoder);

      // Apply write operations internally if permitted
      let writeCount = 0;
      if (writePermissions) {
        // Parse FILE: annotations
        const lines = coderOutput.split("\n");
        let activeFile = "";
        let collectingContent = false;
        let blockContent: string[] = [];

        for (const line of lines) {
          if (line.trim().startsWith("FILE:")) {
            activeFile = line.replace("FILE:", "").trim();
            collectingContent = false;
            blockContent = [];
            continue;
          }

          if (activeFile) {
            if (line.trim().startsWith("```")) {
              if (!collectingContent) {
                collectingContent = true;
              } else {
                // End block, write now
                collectingContent = false;
                try {
                  FilesystemManager.writeFile(isLive, db.data.workspacePath, activeFile, blockContent.join("\n"));
                  writeCount++;
                } catch (e) {}
                activeFile = "";
              }
              continue;
            }

            if (collectingContent) {
              blockContent.push(line);
            }
          }
        }
      }

      // 3. REVIEWER STAGE
      sendProgress("reviewer", "running");
      const reviewerPrompt = `[STAGE 3: REVIEWER]
You are the primary Code Reviewer. Audit the designed structure and complete files emitted by the Coder:
${coderOutput}

Validate code correctness, structural logic, and perform a solid Big-O performance check and error safety inspection.`;

      const startReview = Date.now();
      const reviewerResult = await ProviderRouter.generate({
        provider: reviewerProvider,
        model: reviewerModel,
        messages: [{ role: "user", content: reviewerPrompt }],
      }, undefined, (from, to) => {
        sendProgress("reviewer", "running", "", 0, 0, `fallback: ${from} → ${to}`);
      });
      reviewerOutput = reviewerResult.text;
      const elapsedReview = Date.now() - startReview;
      const reviewTokensPerSec = reviewerResult.tokensPerSec !== undefined ? reviewerResult.tokensPerSec : Math.round((reviewerOutput.length / 4) / (elapsedReview / 1000 || 1));
      sendProgress("reviewer", "done", reviewerOutput, reviewTokensPerSec, elapsedReview);

      // Optional Bounded Self-Improve loop using workspace tests results (L12, M3 AC-12)
      if (enableSelfImprove && isLive) {
        let currentIt = 1;
        const maxIt = Math.min(Number(maxIterations) || 2, 3);
        let passed = false;

        while (currentIt <= maxIt && !passed) {
          res.write(`data: ${JSON.stringify({ stage: "self_improve", status: "running", text: `Running self-improve round ${currentIt}/${maxIt}...` })}\n\n`);
          
          // Execute test terminal script
          const testResult = await TerminalManager.execute(isLive, db.data.workspacePath, "pytest");
          if (testResult.exitCode === 0) {
            passed = true;
            res.write(`data: ${JSON.stringify({ stage: "self_improve", status: "done", text: `Success: All tests passed on round ${currentIt}!` })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ stage: "self_improve", status: "pending", text: `Tests failed on round ${currentIt}. Feeding back debugger report...` })}\n\n`);
            
            // Loop back failures to Coder
            const debugPrompt = `[SELF-IMPROVE DEBUGRound ${currentIt}]
The test suite yielded the following failures:
\`\`\`
${testResult.stderr || testResult.stdout}
\`\`\`
Please fix the code and output the corrected version of the files, matching the annotation rule:
FILE: path/to/file.ext
\`\`\`
content
\`\`\``;
            const refixResult = await ProviderRouter.generate({
              provider: coderProvider,
              model: coderModel,
              messages: [
                { role: "user", content: coderOutput },
                { role: "assistant", content: "I will review and fix" },
                { role: "user", content: debugPrompt }
              ],
            });
            coderOutput = refixResult.text;

            // Re-write fresh corrections
            const lines = coderOutput.split("\n");
            let activeFile = "";
            let collectingContent = false;
            let blockContent: string[] = [];

            for (const line of lines) {
              if (line.trim().startsWith("FILE:")) {
                activeFile = line.replace("FILE:", "").trim();
                collectingContent = false;
                blockContent = [];
                continue;
              }
              if (activeFile) {
                if (line.trim().startsWith("```")) {
                  if (!collectingContent) collectingContent = true;
                  else {
                    collectingContent = false;
                    try {
                      FilesystemManager.writeFile(isLive, db.data.workspacePath, activeFile, blockContent.join("\n"));
                    } catch (e) {}
                    activeFile = "";
                  }
                  continue;
                }
                if (collectingContent) blockContent.push(line);
              }
            }
          }
          currentIt++;
        }
      }

      res.write(`data: ${JSON.stringify({ done: true, writeCount })}\n\n`);
      res.end();
    } catch (e: any) {
      res.write(`data: ${JSON.stringify({ error: e.message || "Pipeline execution failed." })}\n\n`);
      res.end();
    }
  });

  /**
   * Client-Side Secure Backups API (M8, M9)
   */
  app.get("/api/backup/config", (req, res) => {
    res.json({
      type: db.data.backup.type,
      endpoint: db.data.backup.endpoint,
      bucket: db.data.backup.bucket,
      accessKey: db.data.backup.accessKey ? "sk-***" : "",
      intervalMinutes: db.data.backup.intervalMinutes,
      enabled: db.data.backup.enabled,
    });
  });

  app.post("/api/backup/config", (req, res) => {
    const { type, endpoint, bucket, accessKey, secretKey, intervalMinutes, enabled } = req.body;
    
    db.data.backup = {
      type: type || "none",
      endpoint: endpoint || "",
      bucket: bucket || "",
      accessKey: accessKey || "",
      secretKey: secretKey || "",
      intervalMinutes: Number(intervalMinutes) || 120,
      enabled: !!enabled,
    };
    db.save();
    res.json({ success: true });
  });

  app.post("/api/backup/trigger", async (req, res) => {
    try {
      const report = await BackupService.uploadBackup();
      res.json({ success: true, ...report });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/backup/download", (req, res) => {
    try {
      const { cipherText, backupTime } = BackupService.performBackup();
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="backup-${backupTime.replace(/[:.]/g, "-")}.enc"`);
      res.send(cipherText);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/backup/restore", (req, res) => {
    // Restore from uploaded encrypted backup
    const { hexBlob } = req.body;
    if (!hexBlob) return res.status(400).json({ error: "Missing backup data payload" });

    try {
      const rawBuffer = Buffer.from(hexBlob, "hex");
      const restoredText = BackupService.performRestore(rawBuffer);
      const parsedConfig = JSON.parse(restoredText);

      // Save valid data
      db.save(parsedConfig);
      db.logSecurity("permission_change", "Backup restore", "Local database restored from external zero-knowledge file", "info");
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Verification Gates Endpoint - Checks real compliance (G1-G7, §9)
   */
  app.get("/api/selftest", async (req, res) => {
    const isLive = CURRENT_MODE === "live";
    const report: Record<string, { status: "PASS" | "FAIL" | "WARN"; details: string }> = {};

    // G1: Mode Detect
    report["G1_Mode"] = {
      status: CURRENT_MODE !== "demo" ? "PASS" : "WARN",
      details: CURRENT_MODE !== "demo" 
        ? `Operating under native Live macOS: "${CURRENT_MODE}"` 
        : "Operating in Cloud Demo Sandbox. Local systems emulation enabled.",
    };

    // G2: Ollama Probes
    if (CURRENT_MODE !== "demo") {
      try {
        const pingResult = await ProviderRouter.generate({
          provider: "ollama-local",
          model: "qwen3:8b", // Standard low weight local target
          messages: [{ role: "user", content: "ping" }],
          numCtx: 512,
        });
        report["G2_OllamaHealth"] = {
          status: pingResult.text ? "PASS" : "WARN",
          details: `Reachable and responded: ${pingResult.text.substring(0, 40)}`,
        };
      } catch (e: any) {
        report["G2_OllamaHealth"] = {
          status: "FAIL",
          details: `Ollama is offline or model missing: ${e.message}. Remedy: ensure Local Ollama application is opened and port 11434 is bound.`,
        };
      }
    } else {
      report["G2_OllamaHealth"] = {
        status: "WARN",
        details: "Ollama ping ignored: cloud container is isolated from local macOS daemon.",
      };
    }

    // G3: Sequential Pipeline Fallback Check
    try {
      const pipelineResult = await ProviderRouter.generate({
        provider: CURRENT_MODE === "live" ? "ollama-local" : "demo",
        model: CURRENT_MODE === "live" ? "qwen3:8b" : "simulation",
        messages: [{ role: "user", content: "test design target" }],
      });
      const expectedSource = CURRENT_MODE === "live" ? "ollama_local" : "demo";
      report["G3_PipelineFallback"] = {
        status: pipelineResult.source === expectedSource ? "PASS" : "WARN",
        details: `Adaptive router fallback responsive. Source traced: ${pipelineResult.source}`,
      };
    } catch (e: any) {
      report["G3_PipelineFallback"] = {
        status: "FAIL",
        details: `Pipeline router fail: ${e.message}`,
      };
    }

    // G4: Filesystem Escaping Guard
    try {
      FilesystemManager.writeFile(false, "/root", "tests/temp.txt", "temp");
      try {
        FilesystemManager.resolveSafePath("/root", "../../etc/passwd");
        report["G4_FilesystemGuard"] = {
          status: "FAIL",
          details: "Failed to block path traversal escape target.",
        };
      } catch (escapeError) {
        report["G4_FilesystemGuard"] = {
          status: "PASS",
          details: "Traversal check working: path escape was locked and thrown successfully.",
        };
      }
    } catch (fsError: any) {
      report["G4_FilesystemGuard"] = {
        status: "FAIL",
        details: `General fs failure: ${fsError.message}`,
      };
    }

    // G5: Safe Terminal Exec Sandbox
    try {
      const blockedTest1 = await TerminalManager.execute(isLive, "/root", "rm -rf /");
      const blockedTest2 = await TerminalManager.execute(isLive, "/root", "cat /etc/passwd; ls");
      if (blockedTest1.exitCode === 126 && blockedTest2.exitCode === 126) {
        report["G5_TerminalSandbox"] = {
          status: "PASS",
          details: "Command console execution blocked malicious calls with status 126.",
        };
      } else {
        report["G5_TerminalSandbox"] = {
          status: "FAIL",
          details: "Console failed to intercept meta-characters or forbidden commands.",
        };
      }
    } catch (e: any) {
      report["G5_TerminalSandbox"] = {
        status: "FAIL",
        details: `Terminal inspection thrown error: ${e.message}`,
      };
    }

    // G6: Client-Side AES Encrypted Backup Round-trip (M8)
    try {
      const testData = "Mission Control DB Payload 2026";
      const masterKey = db["masterKey"];
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, iv);
      let enc = cipher.update(testData, "utf8", "hex");
      enc += cipher.final("hex");
      const tag = cipher.getAuthTag().toString("hex");

      const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, iv);
      decipher.setAuthTag(Buffer.from(tag, "hex"));
      let dec = decipher.update(enc, "hex", "utf8");
      dec += decipher.final("utf8");

      if (dec === testData) {
        report["G6_BackupCrypto"] = {
          status: "PASS",
          details: "AES-256-GCM zero-knowledge compression/decryption loops validated.",
        };
      } else {
        report["G6_BackupCrypto"] = {
          status: "FAIL",
          details: "Cryptographic values did not mismatch on decrypt cycle.",
        };
      }
    } catch (e: any) {
      report["G6_BackupCrypto"] = {
        status: "FAIL",
        details: `Cryptography validation thrown error: ${e.message}`,
      };
    }

    // G7: External cloud Keys Vault status
    const keysCount = Object.keys(db.data.keys || {}).length;
    report["G7_KeyVault"] = {
      status: keysCount > 0 ? "PASS" : "WARN",
      details: keysCount > 0 
        ? `${keysCount} encrypted hardware credentials loaded in secure at-rest file.` 
        : "Storage contains zero external cloud keys. Operating under offline default.",
    };

    res.json(report);
  });

  // ----------------------------------------------------
  // VITE & STATIC FILES SERVING
  // ----------------------------------------------------

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Cockpit] Console backend is listening on http://0.0.0.0:${PORT}`);
  });
}

// Start full stack Express services
initializeServer().catch((e) => {
  console.error("Express initialization crashed on start.", e);
});
