# LLM Mission Control 🚀
> Premium, privacy-first, local-oriented multi-agent development cockpit and API routing dashboard.

LLM Mission Control brings professional, workstation-locked orchestration to your macOS developer machine. It functions as a single unified system where you can review live telemetry, configure encrypted API key vaults, execute safe terminal sandbox scripts, browse filesystems, manage AES-256 zero-knowledge backups, and invoke a multi-stage **Architect → Coder → Reviewer** pipeline.

---

## 🚀 Dual Mode Architecture (L1)

The software detects its executing environment at boot to ensure complete operational dürüstlük (privacy integrity):

### 1. LIVE Mode (macOS Local Workstation)
- **Local Ollama Daemon Access:** Communicates with host-side Ollama directly on port `11434` with Metal GPU support.
- **Genuine Workspace Explorer:** Browse, open, rewrite, and write files directly within a configured directory with traversal checks.
- **Enforced Terminal Console:** Safe execution of sandboxed test commands and repository actions using a strict binary allowlist.

### 2. DEMO Mode (Cloud Sandboxes / AI Studio Preview)
- **Host Separation:** Runs gracefully, notifying users that they are in a sandboxed, public cloud container isolated from local macOS hardware.
- **Interactive Emulator:** File explorer, CLI commands, and telemetry widgets run inside sandboxed simulation loops so we can safely preview elements.
- **Deploy Wizard:** Outlines step-by-step guidelines to easily export and initial run on home MacBook devices.

---

## 🛠️ Step-by-Step Workstation Setup

### Quick Start (Docker - Recommended)
Unpack the repository ZIP on your Apple Silicon Mac and run:
```bash
chmod +x install.sh
./install.sh
```
This builds compilation stages, mounts your database locally under `~/.llm-mission-control`, binds the web dashboard port, and triggers launch links directly at **http://localhost:3000**.

### Alternative Quick Start (Dockerless)
If you prefer running without container virtualizations:
```bash
# Install package dependencies
npm install

# Run backend express server and hot reload dev SPA
npm run dev
```

---

## 🔌 Integrating GPU-Accelerated Ollama

When executing in **LIVE** mode locally, the cockpit binds GPU-backed Ollama:
- **Default Models Selection:** Architect (`qwen3:8b`), Coder (`qwen3:8b`), Reviewer (`qwen3:8b`). Heavier operations can easily transition to `qwen3-coder:30b`, `deepseek-r1:32b`, or `llama3.3:70b`.
- **Metal GPU Context Window Lock (L7):** Every Ollama generation call enforces a standard `num_ctx` of `8192` tokens. This prevents large reasoning models (such as `qwen3` which defaults to 262,144 tokens) from triggering Out-Of-Memory visual crashes on GPU VRAM channels.
- **Ollama Single Instance Bind (L8):** Ensure that only one process owns macOS port `11434`. If generation pings fail, verify that standard CLI helper daemons don't duplicate background channels. Restart Ollama.app to cleanly bind operations.

---

## 🔒 Security & Client-Side Encryption Backups (M8)

- **Decrypted Vault Keys (M1):** Keys configured within settings (Google Gemini, OpenAI, Claude, OpenRouter) are handled only on server space and saved at-rest encrypted with AES-256-GCM.
- **Command Guardrails (M5):** The CLI console intercepts input parameters. It completely rejects command chains with shell metacharacters (`,`, `&&`, etc.) or blocked tokens (like `rm` or `sudo`), returning clean exit alerts with status 126.
- **AES-256-GCM Zero-Knowledge Backups (M8):** Gzip compresses configuration settings databases in local memory, wraps it with double-pass AES-256-GCM, and syncs encrypted ciphertext only to target S3 or WebDAV directories. Plaintext keys never leave your machine boundary.
- **Firebase Web API Key Security:** The public API key listed in `firebase-applet-config.json` is purely for client-side Authentication / OAuth. It has been strictly restricted at the Google Cloud/Firebase Console level to only allow authorized application domain callbacks, making it fully safe to commit to version control.

---

## 🗺️ Roadmap: Tauri desktop wrappers
Future development supports packaging the core Electron/Tauri container shells to run native menu loops directly from the macOS launch control panel.

---

## 📝 LICENSE
MIT Open-Source Software. Review the `LICENSE` file for more details.
