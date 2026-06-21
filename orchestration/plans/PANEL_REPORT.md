# PANEL_REPORT — ollamas Expert Diagnostic Panel (vO4)

> Üretici: `panel.ts` (DETERMİNİSTİK; LLM yok). ts: 2026-06-20T07:58:05.393Z
> Bayrak: 🤝 consensus-boost · ⚔️ unresolved-debate · 📭 refDeficit · 🕒 stale

## Özet
- Severity: blocker:0  high:1  med:21  low:9  info:0
- Açık (open): 31 · Adopted: 0
- Dedup birleştirme: 1 · Consensus boost: 1
- Persona kapsamı: project-architect:8  prompt-engineer:1  fullstack:0  backend:1  frontend:15  macos:4  integrations:0  mcp:2

## Sıralı bulgular (severity↓, unresolved en sona)
| id | persona | lane | severity | finding | status |
|----|---------|------|----------|---------|--------|
| `backend-backend-1` | backend | backend | 🟧 high | prom-client bağlı (4 kullanım) ama tüketici/dashboard yok — observability boşluğ | open 🤝 |
| `frontend-frontend-1` | frontend | frontend | 🟨 med | 13 component apiClient choke-point'ini atlayıp raw fetch çağırıyor (vF6 ban ihla | open |
| `frontend-frontend-10` | frontend | frontend | 🟨 med | src/components/SecurityPolicies.tsx choke-point bypass — raw fetch/axios (apiCli | open 📭 |
| `frontend-frontend-11` | frontend | frontend | 🟨 med | src/components/SelfTestGates.tsx choke-point bypass — raw fetch/axios (apiClient | open 📭 |
| `frontend-frontend-12` | frontend | frontend | 🟨 med | src/components/VirtualController.tsx choke-point bypass — raw fetch/axios (apiCl | open 📭 |
| `frontend-frontend-13` | frontend | frontend | 🟨 med | src/components/WorkspaceTree.tsx choke-point bypass — raw fetch/axios (apiClient | open 📭 |
| `frontend-frontend-3` | frontend | frontend | 🟨 med | src/components/ClusterManager.tsx choke-point bypass — raw fetch/axios (apiClien | open 📭 |
| `frontend-frontend-4` | frontend | frontend | 🟨 med | src/components/CommandLineTerminal.tsx choke-point bypass — raw fetch/axios (api | open 📭 |
| `frontend-frontend-5` | frontend | frontend | 🟨 med | src/components/GoogleDriveBrowser.tsx choke-point bypass — raw fetch/axios (apiC | open 📭 |
| `frontend-frontend-6` | frontend | frontend | 🟨 med | src/components/KeyVault.tsx choke-point bypass — raw fetch/axios (apiClient dışı | open 📭 |
| `frontend-frontend-7` | frontend | frontend | 🟨 med | src/components/MultiAgentPipeline.tsx choke-point bypass — raw fetch/axios (apiC | open 📭 |
| `frontend-frontend-8` | frontend | frontend | 🟨 med | src/components/ReactAgentTab.tsx choke-point bypass — raw fetch/axios (apiClient | open 📭 |
| `frontend-frontend-9` | frontend | frontend | 🟨 med | src/components/SaaSAdmin.tsx choke-point bypass — raw fetch/axios (apiClient dış | open 📭 |
| `mcp-integrations-1` | mcp | integrations | 🟨 med | DesktopCommander.execute doğrudan (diagnostic.ts+orchestrator.ts) — ToolRegistry | open |
| `mcp-integrations-2` | mcp | integrations | 🟨 med | server/orchestrator.ts choke-point bypass — ToolRegistry.execute dışı doğrudan e | open 📭 |
| `project-architect-backend-orphans` | project-architect | backend | 🟨 med | backend/{contracts,daemon,mesh,orchestrator,sandbox} orphan — hiçbir import yok  | open |
| `project-architect-repo-3` | project-architect | repo | 🟨 med | backend/contracts orphan — kaynak ağacında import yok (unused-code §7) | open 📭 |
| `project-architect-repo-4` | project-architect | repo | 🟨 med | backend/daemon orphan — kaynak ağacında import yok (unused-code §7) | open 📭 |
| `project-architect-repo-5` | project-architect | repo | 🟨 med | backend/mesh orphan — kaynak ağacında import yok (unused-code §7) | open 📭 |
| `project-architect-repo-6` | project-architect | repo | 🟨 med | backend/orchestrator orphan — kaynak ağacında import yok (unused-code §7) | open 📭 |
| `project-architect-repo-7` | project-architect | repo | 🟨 med | backend/sandbox orphan — kaynak ağacında import yok (unused-code §7) | open 📭 |
| `prompt-engineer-repo-1` | prompt-engineer | repo | 🟨 med | Failure-sink (project_cortex.md) boş + SEYIR manuel-only → hata-öğrenme döngüsü  | open |
| `frontend-frontend-14` | frontend | frontend | 🟦 low | src/components/MultiAgentPipeline.tsx oversized component (533 satır > 400) — bö | open 📭 |
| `frontend-frontend-15` | frontend | frontend | 🟦 low | src/components/ReactAgentTab.tsx oversized component (764 satır > 400) — böl/ref | open 📭 |
| `frontend-frontend-2` | frontend | frontend | 🟦 low | ReactAgentTab 764 + MultiAgentPipeline 533 satır — tek-sorumluluk aşımı, bakım y | open |
| `macos-scripts-1` | macos | scripts | 🟦 low | 4 shell script 'set -euo pipefail' eksik — sessiz hata-yutma + unset-var riski | open |
| `macos-scripts-2` | macos | scripts | 🟦 low | join-cluster.sh 'set -euo pipefail' eksik — sessiz hata-yutma riski | open 📭 |
| `macos-scripts-3` | macos | scripts | 🟦 low | setup.sh 'set -euo pipefail' eksik — sessiz hata-yutma riski | open 📭 |
| `macos-scripts-4` | macos | scripts | 🟦 low | uninstall.sh 'set -euo pipefail' eksik — sessiz hata-yutma riski | open 📭 |
| `project-architect-repo-1` | project-architect | repo | 🟦 low | package.json name="react-example" + version="0.0.0" — release-please/server.json | open |
| `project-architect-repo-2` | project-architect | repo | 🟦 low | package.json version="0.0.0" — release-please ile senkron değil | open 📭 |

## Bayraklı listeler
- **refDeficit** (kaynak yetersiz, refs<minRefs): `frontend-frontend-3`, `frontend-frontend-4`, `frontend-frontend-5`, `frontend-frontend-6`, `frontend-frontend-7`, `frontend-frontend-8`, `frontend-frontend-9`, `frontend-frontend-10`, `frontend-frontend-11`, `frontend-frontend-12`, `frontend-frontend-13`, `frontend-frontend-14`, `frontend-frontend-15`, `macos-scripts-2`, `macos-scripts-3`, `macos-scripts-4`, `mcp-integrations-2`, `project-architect-repo-2`, `project-architect-repo-3`, `project-architect-repo-4`, `project-architect-repo-5`, `project-architect-repo-6`, `project-architect-repo-7`
- **unresolvedDebates** (≥2 challenge, 0 support): —
- **consensusBoosted** (≥2 persona aynı bulgu): `backend-backend-1`
- **stale** (targetHash≠HEAD, drift): —

## ⚪ UNCOVERED uzmanlar (0 detected, 0 authored)
- ✅ tüm 8 uzman kapsandı

---
_Bu sekme (orchestration) lane kodunu yazmaz (§3). Bulgular = öneri; çözüm lane sekmesinde uygulanır._

## 📈 Trend (run-to-run delta)

- 🆕 **new** (0): —
- ✅ **resolved** (0): —
- 🔺 **regressed** (0, severity↑): —
- 🔻 **improved** (0, severity↓): —
- ➖ **persistent** (31): değişmeyen bulgu
