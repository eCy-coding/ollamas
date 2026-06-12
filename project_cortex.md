# PROJECT CORTEX: SYSTEM LOG & PRINCIPLES

## STATUS: INITIALIZATION
- **Date:** 2026-06-12
- **Role:** Genesis Quantum Architect & Systems Architect
- **Goal:** Build full-stack LLM Mission Control with zero external dependency bloat.
- **Current Phase:** MVP & Engineering Groundwork

## WORKING PRINCIPLES & GUIDELINES
1. **Dual-Mode Honesty (L1, L8)**:
   - "LIVE mode" detects local macOS & reachable Ollama. Real fs, real commands via sandboxed terminal allowlist.
   - "DEMO mode" detects Cloud Run / AI Studio preview. Disables raw execution, marks status with warning/simulation badges, and serves guided tutorial for local export.
2. **Real Multi-Agent Pipeline (L2, L3)**:
   - Architect → Coder → Reviewer sequential processing chain. Emits real tokens/sec metrics.
   - Dynamic model listing populated via `/api/tags` or cloud providers' models endpoint.
3. **No-leak Crypto-Vault (L9, M1, M8)**:
   - Keys live on server. Encrypted at rest using AES-256-GCM.
   - Zero-knowledge backup: local directory gets zipped/encrypted in memory prior to client-side S3/WebDAV upload.
4. **Performance & Resource Budget (L7, L11)**:
   - Cap context on local models (`num_ctx: 8192` default limit) to prevent GPU Metal Out-Of-Memory crashing.
   - Throttle telemetry polling and run backups on low-priority.

## ARCHITECTURAL STRUCTURE
- `/project_cortex.md`: Self-Audit & Cognitive Bank.
- `/server.ts`: Entrypoint, hosts API, mounts Vite SPA in developmental conditions.
- `/server/db.ts`: Secure JSON-based local database persistence.
- `/server/providers.ts`: Provider routing engine. Multi-provider retries and fallback latency router.
- `/server/files.ts`: Secure path verification and tree explorer.
- `/server/terminal.ts`: Sandy shell allowlist Executor.
- `/server/backup.ts`: AES-256-GCM client-side zip backup package generator.
- `/src/types.ts`: Universal interfaces/typings.
- `/src/components/`: Modular cockpit components.
- `/src/App.tsx`: Unified, fully scalable reactive dashboard manager.

## EXECUTION LOG
- [x] Context and constraints established in `project_cortex.md`.
- [x] Integrate Google Drive functionality (`GoogleDriveBrowser.tsx`).
- [x] Configure Firebase integration (`src/lib/firebase.ts`) and Auth Hook (`useAuth.ts`).
- [x] Added Client-side OAuth with `drive` scope using `signInWithPopup`.
- [ ] Implement secure database engine (`server/db.ts`) with master credentials key.
- [ ] Implement multi-provider server engine (`server/providers.ts`).
- [ ] Design terminal, filesystem, and secure backup services.
- [x] Build React 19 visual cockpit dashboard.
