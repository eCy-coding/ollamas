# E2E_ANALYSIS.md — ollamas 7-Lane Model-Council Analizi

> Oto-üretim: `tsx orchestration/bin/council.ts --all` · 2026-07-01T10:08:59Z
> Her lane atanan model tarafından analiz edildi; checkable iddialar `oracle` ile denetlendi.

## Özet
- Analiz edilen lane: 7/7
- Toplam bulgu: 170 · Yanıtlayan model: qwen3-coder:480b-cloud, qwen3-coder-64k:latest, deepseek-r1:32b, qwen2.5vl:32b, qwen3:8b, qwen3-coder:30b, phi4:latest, qwen3:30b-a3b
- Tüm analiz edilen lane bulgu üretti

## Lane-başı: hangi dil / hangi kod gerekli

### backend  ·  analist: `qwen3-coder:480b-cloud` (66 tok/s)
- **Dil:** TypeScript, Rust, Go
- **Kod işleri:**
  - Implement proper session status tracking in `server/db.ts` to replace quiescence-based detection
  - Add dedicated `steps[]` array support in `ChatSession` model for better step-level tracking
  - Refactor `server/agent-events.ts` to emit structured step events instead of relying on message index polling
  - Extend `server/ai.ts` facade to support explicit model selection and configuration beyond ollama-local
  - Fix tool implementation validation logic in `server/analyzer.ts` to correctly check entryPoint existence
  - Add error handling and timeout logic for SSE stream in `server/agent-events.ts`
- **Risk/borç:**
  - Quiescence-based session completion detection may cause race conditions or missed updates under high load

### backend  ·  analist: `qwen3-coder-64k:latest` (108 tok/s)
- **Dil:** TypeScript, Rust, Go
- **Kod işleri:**
  - Implement structured logging for agent sessions in `agent-events.ts` to support better observability and debugging
  - Add unit tests for `analyzer.ts` tool validation logic to reduce false positives in missing implementation detection
  - Enhance `ai.ts` to support dynamic model selection based on resource availability and performance metrics
  - Refactor `mcp/server.ts` to improve error handling and response formatting for MCP protocol compliance
  - Integrate `billing/stripe.ts` with usage tracking from `key-usage.ts` to enable pay-as-you-go billing
  - Optimize `ecysearcher.ts` indexing performance by implementing batch processing for large document sets
- **Risk/borç:**
  - Potential race condition in `host-bridge.ts` when handling concurrent MCP client connections leading to message loss

### backend  ·  analist: `deepseek-r1:32b` (22 tok/s)
- **Dil:** TypeScript
- **Kod işleri:**
  - Implement SSE completion detection in `agent-events.ts` by monitoring message count quiescence and last assistant turn.
  - Add Gemini provider support to the AI facade in `ai.ts` for enhanced inference capabilities.
  - Refactor MCP components (`mcp/client.ts`, etc.) into a more modular architecture for better maintainability.
  - Improve error handling in SSE streaming to prevent client disconnections and data loss.
  - Optimize memory usage when processing large model outputs in the AI provider chain.
- **Risk/borç:**
  - Inaccurate tool implementation checks in `analyzer.ts` may cause false positives or missed integrations.

### frontend  ·  analist: `qwen2.5vl:32b` (21 tok/s)
- **Dil:** TypeScript/React
- **Kod işleri:**
  - Refactor `web/landing.js` to use React for better component reusability and state management instead of raw DOM manipulation.
  - Enhance `src/App.tsx` by implementing a lazy-loading mechanism for components like `TelemetryCockpit`, `MultiAgentPipeline`, etc., using React's dynamic imports or Suspense.
  - Add unit tests for critical components such as `WorkspaceTree` and `ReactAgentTab` to ensure functionality remains stable during future changes.
  - Integrate styled-components or CSS Modules into the project to manage styles more effectively than global CSS (e.g., replace plain `<style>` blocks in components).
  - Update `useAuth.ts`, `useLogbook.ts`, etc., hooks with type-safe TypeScript interfaces and enhance error handling for better robustness.
- **Risk/borç:**
  - Current use of vanilla JavaScript in `web/landing.js` introduces inconsistencies compared to the rest of the project's React/TypeScript stack, potentially causing maintenance issues.

### frontend  ·  analist: `deepseek-r1:32b` (15 tok/s)
- **Dil:** TypeScript/React, CSS, JavaScript
- **Kod işleri:**
  - Ensure consistent styling between vanilla landing page (web/landing.css) and React components by aligning design tokens usage across both
  - Implement error boundaries for health badge in web/landing.js to handle API failures gracefully
  - Add TypeScript type safety checks to App.tsx component imports to enforce proper typing
  - Optimize state management in MultiAgentPipeline component to reduce unnecessary re-renders
  - Conduct accessibility audit on TelemetryCockpit and fix ARIA labels, keyboard navigation
  - Profile application performance and optimize critical paths in React components
- **Risk/borç:**
  - Potential unhandled errors in health badge API calls leading to misleading UI states

### frontend  ·  analist: `qwen3:8b` (52 tok/s)
- **Dil:** TypeScript/React
- **Kod işleri:**
  - Refactor WorkspaceTree component to use TypeScript interfaces for better type safety and code clarity
  - Update EcySearchPanel to handle dynamic model loading and response parsing for search queries
  - Implement error handling in the GoogleDriveBrowser component for file access and permissions
  - Enhance the TelemetryCockpit component with TypeScript types for metrics and visualization
- **Risk/borç:**
  - The current health check in landing.js may break with future changes to the health payload structure

### cli  ·  analist: `qwen3-coder:30b` (111 tok/s)
- **Dil:** TypeScript, Shell
- **Kod işleri:**
  - Implement TypeScript type definitions for all CLI command handlers in cli/commands/
  - Add unit tests for cli/lib/client.ts and cli/lib/config.ts
  - Enhance ollamas.sh to support new command-line argument parsing for plugin management
  - Refactor cli/bin/role-hook.ts to use async/await instead of execFileSync
  - Update cli/build-binary.sh to include bundled dependency verification step
  - Add logging middleware to cli/lib/mcp.ts for debugging gateway requests
- **Risk/borç:**
  - Missing error handling in cli/lib/keychain.ts when retrieving API keys from OS keychain

### cli  ·  analist: `deepseek-r1:32b` (5 tok/s)
- **Dil:** TypeScript
- **Kod işleri:**
  - Implement error handling and logging in cli/bin/role-hook.ts
  - Add metrics collection for CLI commands in cli/lib/metrics.ts
  - Ensure cross-platform compatibility across Linux, macOS, and Windows
  - Improve output formatting for human-readable commands like doctor and top
  - Optimize performance of fleet management in cli/lib/fleet.ts
  - Implement security best practices in key handling (API keys, etc.)
- **Risk/borç:**
  - Potential security vulnerabilities if Node.js built-ins are not properly polyfilled when compiling to native binaries

### cli  ·  analist: `qwen3:8b` (39 tok/s)
- **Dil:** TypeScript
- **Kod işleri:**
  - Implement SSE support in cli/lib/client.ts for real-time agent output
  - Add missing error handling for MCP gateway connection in cli/lib/mcp.ts
  - Refactor cli/commands/agent.ts to support async/await for better readability
  - Improve cli/lib/completion.ts to handle different model response formats
- **Risk/borç:**
  - Current CLI may crash on unexpected API responses without proper error handling

### scripts  ·  analist: `qwen3-coder:30b` (108 tok/s)
- **Dil:** TypeScript, JavaScript, Shell
- **Kod işleri:**
  - Refactor agent-bench.mjs to use a more robust argument parsing library like yargs for better CLI handling
  - Add unit tests for agent-dispatch.mjs to validate structured report generation and exit codes
  - Implement logging middleware in agent-fleet.mjs to track sub-agent performance metrics
  - Convert shell scripts (like fleet-up.sh) to TypeScript for better error handling and cross-platform compatibility
  - Add type definitions for all script interfaces and improve JSDoc documentation
  - Integrate environment variable validation into ops.mjs to prevent runtime failures from misconfigured deployments
- **Risk/borç:**
  - Potential race conditions in agent-fleet.mjs when aggregating results from multiple sub-agents without proper synchronization

### scripts  ·  analist: `phi4:latest` (14 tok/s)
- **Dil:** TypeScript, Shell
- **Kod işleri:**
  - Implement unit tests for agent-dispatch.mjs using a testing framework like Jest to ensure deterministic output across various tasks.
  - Optimize scripts/agent-bench.mjs to handle larger sets of models and steps efficiently without exceeding OLLAMAS_TIMEOUT_MS.
  - Refactor agent-fleet.mjs to improve readability and maintainability by modularizing code into smaller, reusable functions.
  - Develop a logging mechanism for all scripts to capture detailed runtime information and errors, aiding in debugging and monitoring.
  - Enhance the error handling in scripts like firecrawl.mjs to gracefully manage unexpected failures or exceptions during execution.
- **Risk/borç:**
  - The reliance on hardcoded environment variables (e.g., OLLAMAS_URL) without validation could lead to runtime errors if not set correctly.

### scripts  ·  analist: `deepseek-r1:32b` (8 tok/s)
- **Dil:** JavaScript (mjs), TypeScript (ts), Shell
- **Kod işleri:**
  - Update Node.js module dependencies to their latest versions for improved security and functionality.
  - Implement TypeScript compiler options (`tsconfig.json`) to enforce strict type checks across all .ts files.
  - Add error handling in shell scripts to prevent silent failures and improve debugging.
  - Refactor large functions in TypeScript files into smaller, more maintainable utility functions.
  - Improve logging and error messages in JavaScript modules for better traceability.
  - Update documentation for environment variables and command-line arguments across all scripts.
- **Risk/borç:**
  - Missing TypeScript compiler options may lead to unnoticed type-related bugs in .ts files.

### integrations  ·  analist: `qwen3-coder:480b-cloud` (58 tok/s)
- **Dil:** TypeScript, Shell
- **Kod işleri:**
  - Implement structured logging in all tunnel/src/*.ts modules using a shared logger interface
  - Add unit tests for error paths in tunnel/src/transport.ts and tunnel/src/transports/caddy-tls.test.ts
  - Refactor tunnel/scripts/whoami.sh to output JSON format for better integration with downstream tools
  - Extend client/ai-client.ts to support model downloading and caching with integrity verification
  - Create a new transport module for WebSocket fallback in tunnel/src/transports/ws.ts
  - Add retry logic with exponential backoff to tunnel/src/connectivity.ts health checks
- **Risk/borç:**
  - Missing input validation in ai-client.ts options may lead to injection or denial of service
  - Bash script whoami.sh lacks error handling for missing commands like git or node

### integrations  ·  analist: `deepseek-r1:32b` (7 tok/s)
- **Dil:** TypeScript
- **Kod işleri:**
  - Implement comprehensive type safety checks for the TunnelSwitch class in `tunnel/src/switch.ts`.
  - Add integration tests for the auto-pilot feature in `tunnel/src/autopilot.test.ts` to ensure proper transport prioritization under varying network conditions.
  - Refactor the tunnel transport layer in `tunnel/src/transport.ts` to support WebSockets alongside existing HTTP transports.
  - Implement rate-limiting and circuit-breaker logic in `tunnel/src/breaker.ts` to prevent abuse of local LLM resources.
  - Add documentation for all exported interfaces in `client/ai-client.ts` to improve developer experience.
  - Optimize the TypeScript compiler configuration in `tsconfig.json` to reduce build times while maintaining type safety guarantees.
- **Risk/borç:**
  - Potential race conditions in the tunnel endpoint switching logic if transports are not properly synchronized.

### integrations  ·  analist: `qwen3:8b` (32 tok/s)
- **Dil:** TypeScript, Shell
- **Kod işleri:**
  - Implement missing transport protocols in transport.ts to support additional tunnel connectivity options
  - Add comprehensive error handling for crypto operations in crypto.ts
  - Refactor cli.ts to improve argument parsing and user feedback
  - Enhance the health check logic in health.ts to include more detailed metrics
- **Risk/borç:**
  - Current transport implementations may have incomplete fallback mechanisms leading to connectivity failures

### bench  ·  analist: `kimi-k2.5:cloud`
- ⚠️ yanıt yok / bulgu yok — HTTP 500

### bench  ·  analist: `deepseek-r1:32b` (7 tok/s)
- **Dil:** JavaScript/TypeScript
- **Kod işleri:**
  - Improve error handling in `agent-bench.mjs` to prevent false negatives in benchmarking results.
  - Add retry logic for failed tasks in `agent-dispatch.mjs` to handle transient errors.
  - Optimize parallel execution in `oracle-bench.mjs` and `provider-bench.mjs` to reduce resource contention.
  - Enhance metric extraction in `measure-extract.mjs` to capture more detailed performance data.
  - Add retry logic for failed end-to-end tests in `e2e_verify.ts`.
  - Improve logging in shell scripts like `fleet-up.sh` and `oracle-verify-gate.sh` to better track process state.
- **Risk/borç:**
  - Potential benchmarking errors could lead to incorrect routing decisions, affecting task distribution accuracy.

### bench  ·  analist: `qwen3:8b` (32 tok/s)
- **Dil:** TypeScript
- **Kod işleri:**
  - Refactor scripts/master_e2e_workflow.ts to improve type safety and error handling
  - Implement TypeScript interfaces for agent-bench.mjs and agent-dispatch.mjs to standardize input/output types
  - Add type definitions for the JSON output in agent-dispatch.mjs to ensure consistency across sub-agents
- **Risk/borç:**
  - Inconsistent type handling between JavaScript and TypeScript files may lead to runtime errors in the fleet coordination logic

### orchestration  ·  analist: `qwen3-coder-64k:latest` (109 tok/s)
- **Dil:** TypeScript, Shell
- **Kod işleri:**
  - Implement unit tests for `orchestration/bin/lib/autopilot.ts` to validate autopilot agent lifecycle management
  - Add logging instrumentation to `orchestration/bin/activate.sh` for better debugging of launchd integration
  - Refactor `orchestration/bin/adopt.ts` to support dynamic license validation rules from external config file
  - Create a TypeScript interface for the SBOM data structure used in `adopt-gate.ts` and `sbom.ts`
  - Add error handling for missing syft binary in `orchestration/bin/adopt-gate.ts` with fallback message
  - Document the CLI contract for `orchestration/bin/conduct.ts` including expected input/output formats
- **Risk/borç:**
  - Missing dependency validation in `adopt-gate.ts` may cause false negatives on copyleft license detection

### orchestration  ·  analist: `qwen3:30b-a3b` (55 tok/s)
- **Dil:** The programming language(s) that need work (e.g., TypeScript, Shell); TypeScript; TypeScript; TypeScript; TypeScript
- **Kod işleri:**
  - One or two concrete, specific coding tasks to advance this lane (max 6 lines)
  - In `orchestration/bin/adopt-gate.ts`, add a function to check for `syft` and skip SBOM audit if not present, logging a warning.
  - Add syft existence check in orchestration/bin/adopt-gate.ts to skip SBOM audit without error when syft is missing.
  - Update orchestration/bin/adopt.ts to use the same license matrix validation as adopt-gate.ts for consistency (if there's a discrepancy in how the matrix is parsed).
  - In orchestration/bin/adopt-gate.ts, add a pre-check for 'syft' in the system PATH before running SBOM audit, and skip if not found (with a warning log).
  - In orchestration/bin/adopt.ts, refactor the matrix parsing to be a shared function used by both adopt.ts and adopt-gate.ts to avoid duplication.
  - Add syft existence check in orchestration/bin/adopt-gate.ts to skip SBOM audit without error when syft is missing
  - Refactor license matrix parsing in orchestration/bin/adopt.ts to be a shared utility function for adopt.ts and adopt-gate.ts
  - Add syft existence check in orchestration/bin/adopt-gate.ts to skip SBOM audit without error when syft is missing
  - Refactor license matrix parsing in orchestration/bin/adopt.ts to be a shared utility function for adopt.ts and adopt-gate.ts
  - In orchestration/bin/adopt-gate.ts, add a check for 'syft' command in PATH before running SBOM audit, and if missing, skip the audit with a console warning.
  - Extract the matrix parsing logic from adopt.ts into a shared module (e.g., in lib) to be used by both adopt.ts and adopt-gate.ts
  - Add syft existence check in orchestration/bin/adopt-gate.ts to skip SBOM audit without error
  - Refactor matrix parsing in orchestration/bin/adopt.ts to a shared utility function
  - Add syft existence check in orchestration/bin/adopt-gate.ts to skip SBOM audit without error when syft is missing
  - Refactor matrix parsing logic from orchestration/bin/adopt.ts into shared lib/adoptions.ts for consistency
- **Risk/borç:**
  - A concrete bug, risk, or technical debt (omit if none)
  - The current implementation of `adopt-gate.ts` might fail to run in environments without `syft` (which is a common scenario in CI without the tool installed), causing unnecessary build failures.
  - adopt-gate.ts currently crashes when syft is not installed, causing false positives in OSS adoption gate
  - adopt-gate.ts fails with 'syft not found' error when run without syft, blocking CI even though SBOM audit is optional.
  - adopt-gate.ts fails with 'syft not found' error when syft is not installed, causing unnecessary build failures
  - Current adopt-gate.ts implementation fails with error when syft is not installed, which is a bug because the SBOM audit is optional and should not cause a hard failure.
  - adopt-gate.ts crashes when syft is missing, causing false positive gate failures
  - adopt-gate.ts currently crashes with "syft not found" error when run without syft, causing false positives in OSS license gate (despite being optional)

### orchestration  ·  analist: `deepseek-r1:32b` (7 tok/s)
- **Dil:** TypeScript
- **Kod işleri:**
  - Implement enhanced error handling and logging in activate.sh for better portability and user feedback.
  - Improve the syft audit process in adopt-gate.ts by adding fallback mechanisms when syft is unavailable.
  - Add comprehensive license detection logic to adopt.ts to automate compliance checks more effectively.
  - Refactor common functions across orchestration scripts into a shared TypeScript library to reduce redundancy.
  - Update documentation for maintainers detailing the adoption gate process and requirements.
  - Enhance doctor checks in activate.sh to handle edge cases better, ensuring reliable activation.
- **Risk/borç:**
  - Potential false negatives or positives in license detection leading to compliance issues.

## Oracle denetimi (deterministik yer-gerçeği)
- [UNDECIDABLE] `Extend `server/ai.ts` facade to support explicit model selection and configuration beyond ollama-local` — out-of-scope: Bu girdi deterministik bir kategoriye (matematik/mantık/sıra/kod) oturmuyor; nesnel doğru/yanlış verilemez.
- [UNDECIDABLE] `Add error handling and timeout logic for SSE stream in `server/agent-events.ts`` — out-of-scope: Bu girdi deterministik bir kategoriye (matematik/mantık/sıra/kod) oturmuyor; nesnel doğru/yanlış verilemez.
- [UNDECIDABLE] `Quiescence-based session completion detection may cause race conditions or missed updates under high load` — out-of-scope: Bu girdi deterministik bir kategoriye (matematik/mantık/sıra/kod) oturmuyor; nesnel doğru/yanlış verilemez.
- [UNDECIDABLE] `Implement structured logging for agent sessions in `agent-events.ts` to support better observability and debugging` — value-judgment: Değer/etik/estetik yargısı içeriyor — gözlemciden bağımsız hesapla kararlaştırılamaz; evrensel doğru/yanlış kapsamı dışı
- [UNDECIDABLE] `Enhance `ai.ts` to support dynamic model selection based on resource availability and performance metrics` — out-of-scope: Bu girdi deterministik bir kategoriye (matematik/mantık/sıra/kod) oturmuyor; nesnel doğru/yanlış verilemez.
- [UNDECIDABLE] `Refactor `mcp/server.ts` to improve error handling and response formatting for MCP protocol compliance` — out-of-scope: Bu girdi deterministik bir kategoriye (matematik/mantık/sıra/kod) oturmuyor; nesnel doğru/yanlış verilemez.
- [UNDECIDABLE] `Implement SSE completion detection in `agent-events.ts` by monitoring message count quiescence and last assistant turn.` — out-of-scope: Bu girdi deterministik bir kategoriye (matematik/mantık/sıra/kod) oturmuyor; nesnel doğru/yanlış verilemez.
- [UNDECIDABLE] `Improve error handling in SSE streaming to prevent client disconnections and data loss.` — out-of-scope: Bu girdi deterministik bir kategoriye (matematik/mantık/sıra/kod) oturmuyor; nesnel doğru/yanlış verilemez.
- [UNDECIDABLE] `Inaccurate tool implementation checks in `analyzer.ts` may cause false positives or missed integrations.` — out-of-scope: Bu girdi deterministik bir kategoriye (matematik/mantık/sıra/kod) oturmuyor; nesnel doğru/yanlış verilemez.
- [UNDECIDABLE] `Refactor `web/landing.js` to use React for better component reusability and state management instead of raw DOM manipulation.` — value-judgment: Değer/etik/estetik yargısı içeriyor — gözlemciden bağımsız hesapla kararlaştırılamaz; evrensel doğru/yanlış kapsamı dışı
- [UNDECIDABLE] `Enhance `src/App.tsx` by implementing a lazy-loading mechanism for components like `TelemetryCockpit`, `MultiAgentPipeline`, etc., using React's dynamic imports or Suspense.` — out-of-scope: Bu girdi deterministik bir kategoriye (matematik/mantık/sıra/kod) oturmuyor; nesnel doğru/yanlış verilemez.
- [UNDECIDABLE] `Add unit tests for critical components such as `WorkspaceTree` and `ReactAgentTab` to ensure functionality remains stable during future changes.` — value-judgment: Değer/etik/estetik yargısı içeriyor — gözlemciden bağımsız hesapla kararlaştırılamaz; evrensel doğru/yanlış kapsamı dışı
- [UNDECIDABLE] `Integrate styled-components or CSS Modules into the project to manage styles more effectively than global CSS (e.g., replace plain `<style>` blocks in components).` — out-of-scope: Bu girdi deterministik bir kategoriye (matematik/mantık/sıra/kod) oturmuyor; nesnel doğru/yanlış verilemez.
- [UNDECIDABLE] `Update `useAuth.ts`, `useLogbook.ts`, etc., hooks with type-safe TypeScript interfaces and enhance error handling for better robustness.` — value-judgment: Değer/etik/estetik yargısı içeriyor — gözlemciden bağımsız hesapla kararlaştırılamaz; evrensel doğru/yanlış kapsamı dışı
- [UNDECIDABLE] `Ensure consistent styling between vanilla landing page (web/landing.css) and React components by aligning design tokens usage across both` — out-of-scope: Bu girdi deterministik bir kategoriye (matematik/mantık/sıra/kod) oturmuyor; nesnel doğru/yanlış verilemez.
- [UNDECIDABLE] `Conduct accessibility audit on TelemetryCockpit and fix ARIA labels, keyboard navigation` — out-of-scope: Bu girdi deterministik bir kategoriye (matematik/mantık/sıra/kod) oturmuyor; nesnel doğru/yanlış verilemez.
- [UNDECIDABLE] `Profile application performance and optimize critical paths in React components` — out-of-scope: Bu girdi deterministik bir kategoriye (matematik/mantık/sıra/kod) oturmuyor; nesnel doğru/yanlış verilemez.
- [UNDECIDABLE] `Refactor WorkspaceTree component to use TypeScript interfaces for better type safety and code clarity` — value-judgment: Değer/etik/estetik yargısı içeriyor — gözlemciden bağımsız hesapla kararlaştırılamaz; evrensel doğru/yanlış kapsamı dışı
- [UNDECIDABLE] `Update EcySearchPanel to handle dynamic model loading and response parsing for search queries` — out-of-scope: Bu girdi deterministik bir kategoriye (matematik/mantık/sıra/kod) oturmuyor; nesnel doğru/yanlış verilemez.
- [UNDECIDABLE] `Implement error handling in the GoogleDriveBrowser component for file access and permissions` — out-of-scope: Bu girdi deterministik bir kategoriye (matematik/mantık/sıra/kod) oturmuyor; nesnel doğru/yanlış verilemez.

> Öncelik sıralaması için: `tsx orchestration/bin/conduct.ts` (RED > eksik > bayat).
