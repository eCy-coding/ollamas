# DRIFT — ollamas Drift-Guard (vO8)

> Deterministik GATE (0-manuel). 14 HARD + 4 soft. exit=1.

## 🟥 HARD (tutarsızlık — düzeltilmeli)
- [HARD] `frontend` choke-point · src/components: tek choke-point ⇒ 13 component apiClient choke-point'ini atlayıp raw fetch çağırıyor (vF6 ban ihla  _(panel detected (REUSE))_
- [HARD] `frontend` choke-point · src/components/ClusterManager.tsx: tek choke-point ⇒ src/components/ClusterManager.tsx choke-point bypass — raw fetch/axios (apiClien  _(panel detected (REUSE))_
- [HARD] `frontend` choke-point · src/components/CommandLineTerminal.tsx: tek choke-point ⇒ src/components/CommandLineTerminal.tsx choke-point bypass — raw fetch/axios (api  _(panel detected (REUSE))_
- [HARD] `frontend` choke-point · src/components/GoogleDriveBrowser.tsx: tek choke-point ⇒ src/components/GoogleDriveBrowser.tsx choke-point bypass — raw fetch/axios (apiC  _(panel detected (REUSE))_
- [HARD] `frontend` choke-point · src/components/KeyVault.tsx: tek choke-point ⇒ src/components/KeyVault.tsx choke-point bypass — raw fetch/axios (apiClient dışı  _(panel detected (REUSE))_
- [HARD] `frontend` choke-point · src/components/MultiAgentPipeline.tsx: tek choke-point ⇒ src/components/MultiAgentPipeline.tsx choke-point bypass — raw fetch/axios (apiC  _(panel detected (REUSE))_
- [HARD] `frontend` choke-point · src/components/ReactAgentTab.tsx: tek choke-point ⇒ src/components/ReactAgentTab.tsx choke-point bypass — raw fetch/axios (apiClient  _(panel detected (REUSE))_
- [HARD] `frontend` choke-point · src/components/SaaSAdmin.tsx: tek choke-point ⇒ src/components/SaaSAdmin.tsx choke-point bypass — raw fetch/axios (apiClient dış  _(panel detected (REUSE))_
- [HARD] `frontend` choke-point · src/components/SecurityPolicies.tsx: tek choke-point ⇒ src/components/SecurityPolicies.tsx choke-point bypass — raw fetch/axios (apiCli  _(panel detected (REUSE))_
- [HARD] `frontend` choke-point · src/components/SelfTestGates.tsx: tek choke-point ⇒ src/components/SelfTestGates.tsx choke-point bypass — raw fetch/axios (apiClient  _(panel detected (REUSE))_
- [HARD] `frontend` choke-point · src/components/VirtualController.tsx: tek choke-point ⇒ src/components/VirtualController.tsx choke-point bypass — raw fetch/axios (apiCl  _(panel detected (REUSE))_
- [HARD] `frontend` choke-point · src/components/WorkspaceTree.tsx: tek choke-point ⇒ src/components/WorkspaceTree.tsx choke-point bypass — raw fetch/axios (apiClient  _(panel detected (REUSE))_
- [HARD] `integrations` choke-point · server/diagnostic.ts: tek choke-point ⇒ DesktopCommander.execute doğrudan (diagnostic.ts+orchestrator.ts) — ToolRegistry  _(panel detected (REUSE))_
- [HARD] `integrations` choke-point · server/orchestrator.ts: tek choke-point ⇒ server/orchestrator.ts choke-point bypass — ToolRegistry.execute dışı doğrudan e  _(panel detected (REUSE))_

## 🟦 SOFT (uyarı — meşru olabilir)
- [SOFT] `cli` branch-coherence · branch: roadmap:v11 ⇒ branch-token:2  _(branch sürüm-token'ı ROADMAP'tan farklı (feature-branch için meşru olabilir; UK-07))_
- [SOFT] `frontend` branch-coherence · branch: roadmap:vF10 ⇒ branch-token:3  _(branch sürüm-token'ı ROADMAP'tan farklı (feature-branch için meşru olabilir; UK-07))_
- [SOFT] `orchestration` branch-coherence · branch: roadmap:vO7 ⇒ branch-token:3  _(branch sürüm-token'ı ROADMAP'tan farklı (feature-branch için meşru olabilir; UK-07))_
- [SOFT] `scripts` branch-coherence · branch: roadmap:v12 ⇒ branch-token:1  _(branch sürüm-token'ı ROADMAP'tan farklı (feature-branch için meşru olabilir; UK-07))_
