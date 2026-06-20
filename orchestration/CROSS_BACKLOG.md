# CROSS_BACKLOG — Conductor → Lane Critical Teslim

> 5 lane · 32 critical bulgu (drift HARD + quality RED + panel). Severity-toplamına göre sıralı.
> Her section'ı sahibi lane sekmesine yapıştır. Conductor üretir, lane uygular (§3).

## Backlog — `frontend` lane (15 critical)

> Conductor üretti (READ-ONLY). Bu prompt'u `frontend` sekmesine YAPIŞTIR → düzelt. Conductor FIXLEMEZ (§3).

1. **[50 panel]** 13 component apiClient choke-point'ini atlayıp raw fetch çağırıyor (vF6 ban ihlali) (src/components)
   🔧 Tüm HTTP'yi src/lib/apiClient.ts üzerinden geçir (tek choke-point: auth header, retry, base-url, error). ESLint no-restricted-syntax ile raw fetch'i CI'de banla (frontend lane'de zaten kural var → kapsamı genişlet). Veri-çekme için TanStack Query merkezi client deseni.
2. **[50 panel]** src/components/ClusterManager.tsx choke-point bypass — raw fetch/axios (apiClient dışı çağrı) (src/components/ClusterManager.tsx)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.
3. **[50 panel]** src/components/CommandLineTerminal.tsx choke-point bypass — raw fetch/axios (apiClient dışı çağrı) (src/components/CommandLineTerminal.tsx)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.
4. **[50 panel]** src/components/GoogleDriveBrowser.tsx choke-point bypass — raw fetch/axios (apiClient dışı çağrı) (src/components/GoogleDriveBrowser.tsx)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.
5. **[50 panel]** src/components/KeyVault.tsx choke-point bypass — raw fetch/axios (apiClient dışı çağrı) (src/components/KeyVault.tsx)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.
6. **[50 panel]** src/components/MultiAgentPipeline.tsx choke-point bypass — raw fetch/axios (apiClient dışı çağrı) (src/components/MultiAgentPipeline.tsx)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.
7. **[50 panel]** src/components/ReactAgentTab.tsx choke-point bypass — raw fetch/axios (apiClient dışı çağrı) (src/components/ReactAgentTab.tsx)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.
8. **[50 panel]** src/components/SaaSAdmin.tsx choke-point bypass — raw fetch/axios (apiClient dışı çağrı) (src/components/SaaSAdmin.tsx)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.
9. **[50 panel]** src/components/SecurityPolicies.tsx choke-point bypass — raw fetch/axios (apiClient dışı çağrı) (src/components/SecurityPolicies.tsx)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.
10. **[50 panel]** src/components/SelfTestGates.tsx choke-point bypass — raw fetch/axios (apiClient dışı çağrı) (src/components/SelfTestGates.tsx)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.
11. **[50 panel]** src/components/VirtualController.tsx choke-point bypass — raw fetch/axios (apiClient dışı çağrı) (src/components/VirtualController.tsx)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.
12. **[50 panel]** src/components/WorkspaceTree.tsx choke-point bypass — raw fetch/axios (apiClient dışı çağrı) (src/components/WorkspaceTree.tsx)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.
13. **[20 panel]** ReactAgentTab 764 + MultiAgentPipeline 533 satır — tek-sorumluluk aşımı, bakım yükü (src/components/ReactAgentTab.tsx)
   🔧 Alt-component + custom hook'lara böl (container/presentational ayrımı). State'i hook'a çıkar. 400 satır eşiğini size-limit gibi CI gate'e bağla.
14. **[20 panel]** src/components/MultiAgentPipeline.tsx oversized component (533 satır > 400) — böl/refactor (src/components/MultiAgentPipeline.tsx)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.
15. **[20 panel]** src/components/ReactAgentTab.tsx oversized component (764 satır > 400) — böl/refactor (src/components/ReactAgentTab.tsx)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.

**Çalışma prensibi:** LANE_AGENTS'a uy · **TDD** (test önce) · **root-cause-first** (semptom YASAK) · **gate-before-commit** (lint+test+conformance) · per-file `git add` (asla -A) · adopt-not-vibe (top-star macOS repo).

## Backlog — `repo` lane (8 critical)

> Conductor üretti (READ-ONLY). Bu prompt'u `repo` sekmesine YAPIŞTIR → düzelt. Conductor FIXLEMEZ (§3).

1. **[50 panel]** backend/contracts orphan — kaynak ağacında import yok (unused-code §7) (backend/contracts)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.
2. **[50 panel]** backend/daemon orphan — kaynak ağacında import yok (unused-code §7) (backend/daemon)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.
3. **[50 panel]** backend/mesh orphan — kaynak ağacında import yok (unused-code §7) (backend/mesh)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.
4. **[50 panel]** backend/orchestrator orphan — kaynak ağacında import yok (unused-code §7) (backend/orchestrator)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.
5. **[50 panel]** backend/sandbox orphan — kaynak ağacında import yok (unused-code §7) (backend/sandbox)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.
6. **[50 panel]** Failure-sink (project_cortex.md) boş + SEYIR manuel-only → hata-öğrenme döngüsü kapalı (project_cortex.md)
   🔧 logSeyir.jsonl'i prompt-context'e besleyen bir 'don't-repeat' enjeksiyonu kur (orchestration plan-next.ts errors_registry deseni). System-prompt'a son N hata + prevention_rule otomatik eklensin. Reflexion/self-refine deseni: ajan hatasını sink'e yazsın, sonraki turda okusun.
7. **[20 panel]** package.json name="react-example" + version="0.0.0" — release-please/server.json ile uyumsuz (package.json)
   🔧 name'i 'ollamas'a, version'ı server.json ile aynı semver'e çek. release-please zaten var → manifest'e package.json ekle ki sürüm otomatik bump'lansın, drift bitsin.
8. **[20 panel]** package.json version="0.0.0" — release-please ile senkron değil (package.json)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.

**Çalışma prensibi:** LANE_AGENTS'a uy · **TDD** (test önce) · **root-cause-first** (semptom YASAK) · **gate-before-commit** (lint+test+conformance) · per-file `git add` (asla -A) · adopt-not-vibe (top-star macOS repo).

## Backlog — `backend` lane (3 critical)

> Conductor üretti (READ-ONLY). Bu prompt'u `backend` sekmesine YAPIŞTIR → düzelt. Conductor FIXLEMEZ (§3).

1. **[85 quality]** Quality RED: test failed
   🔧 Lane testlerini koş, KÖK-neden düzelt (semptom YASAK); gate (lint+test) geçmeden commit etme.
2. **[80 panel]** prom-client bağlı (4 kullanım) ama tüketici/dashboard yok — observability boşluğu (server/metrics.ts)
   🔧 Prometheus scrape + Grafana dashboard JSON repo'ya ekle (deploy/). MCP tarafında trace için OpenTelemetry MCP server consume edilebilir → AI ajan distributed trace okur. Önce /metrics'i bir dashboard'a bağla, sonra logSeyir.jsonl'i de aynı panele besle.
3. **[50 panel]** backend/{contracts,daemon,mesh,orchestrator,sandbox} orphan — hiçbir import yok (unused-code §7) (backend/)
   🔧 Dead-code teyidi sonrası sil VEYA ROADMAP'e gerçek owner+plan bağla. git mv ile arşivle, knip/ts-prune ile CI'de orphan-export gate kur ki yeniden birikmesin.

**Çalışma prensibi:** LANE_AGENTS'a uy · **TDD** (test önce) · **root-cause-first** (semptom YASAK) · **gate-before-commit** (lint+test+conformance) · per-file `git add` (asla -A) · adopt-not-vibe (top-star macOS repo).

## Backlog — `integrations` lane (2 critical)

> Conductor üretti (READ-ONLY). Bu prompt'u `integrations` sekmesine YAPIŞTIR → düzelt. Conductor FIXLEMEZ (§3).

1. **[50 panel]** DesktopCommander.execute doğrudan (diagnostic.ts+orchestrator.ts) — ToolRegistry choke-point dışı host-exec (server/diagnostic.ts)
   🔧 Host-komut yürütmeyi ToolRegistry.execute üzerinden geçir (tek choke-point → per-tenant allowlist + metering + redaction). Meşru sistem-içi çağrıysa AGENTS'e açık istisna + audit-log ekle. MCP server referans deseni: tüm tool dispatch tek registry'den.
2. **[50 panel]** server/orchestrator.ts choke-point bypass — ToolRegistry.execute dışı doğrudan execute/handler (server/orchestrator.ts)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.

**Çalışma prensibi:** LANE_AGENTS'a uy · **TDD** (test önce) · **root-cause-first** (semptom YASAK) · **gate-before-commit** (lint+test+conformance) · per-file `git add` (asla -A) · adopt-not-vibe (top-star macOS repo).

## Backlog — `scripts` lane (4 critical)

> Conductor üretti (READ-ONLY). Bu prompt'u `scripts` sekmesine YAPIŞTIR → düzelt. Conductor FIXLEMEZ (§3).

1. **[20 panel]** 4 shell script 'set -euo pipefail' eksik — sessiz hata-yutma + unset-var riski (*.sh)
   🔧 Her script'in shebang sonrasına 'set -euo pipefail' ekle (bash strict mode). CI'de ShellCheck (SC2086 unquoted, SC2164 cd-fail) gate'i koş — frontend lhci deseni gibi. ShellCheck GPL-3.0 → BİNARİ kullan (kod kopyalama), kural-fikri serbest.
2. **[20 panel]** join-cluster.sh 'set -euo pipefail' eksik — sessiz hata-yutma riski (join-cluster.sh)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.
3. **[20 panel]** setup.sh 'set -euo pipefail' eksik — sessiz hata-yutma riski (setup.sh)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.
4. **[20 panel]** uninstall.sh 'set -euo pipefail' eksik — sessiz hata-yutma riski (uninstall.sh)
   🔧 Panel teşhisi — kaynak araştır (LANE_ADOPTION), düzelt.

**Çalışma prensibi:** LANE_AGENTS'a uy · **TDD** (test önce) · **root-cause-first** (semptom YASAK) · **gate-before-commit** (lint+test+conformance) · per-file `git add` (asla -A) · adopt-not-vibe (top-star macOS repo).
