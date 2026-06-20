# ROADMAP_HORIZON — ollamas Orchestration (vO12+)

> Otomatik üretildi (DETERMİNİSTİK, 0-manuel): `horizon.ts` — critic+panel+drift+backlog sinyalleri → sıralı versiyon. ts: 2026-06-20T11:53:46.670Z
> Roadmap tükendiğinde lane'in durmaması için sonraki 10 versiyonu önerir. İnsan/conductor onayıyla ROADMAP'e işlenir.

| Versiyon | Kapsam (sinyalden) | Severity | Kaynak | Lane |
|----------|--------------------|----------|--------|------|
| **vO12** | prom-client bağlı (4 kullanım) ama tüketici/dashbo | 80 | panel | backend |
| **vO13** | ReactAgentTab 764 + MultiAgentPipeline 533 satır — | 66 | panel | frontend |
| **vO14** | src/components/MultiAgentPipeline.tsx choke-point  | 58 | panel | frontend |
| **vO15** | backend/{contracts,daemon,mesh,orchestrator,sandbo | 50 | panel | backend |
| **vO16** | 13 component apiClient choke-point'ini atlayıp raw | 50 | panel | frontend |
| **vO17** | src/components/ClusterManager.tsx choke-point bypa | 50 | panel | frontend |
| **vO18** | src/components/CommandLineTerminal.tsx choke-point | 50 | panel | frontend |
| **vO19** | src/components/GoogleDriveBrowser.tsx choke-point  | 50 | panel | frontend |
| **vO20** | src/components/KeyVault.tsx choke-point bypass — r | 50 | panel | frontend |
| **vO21** | src/components/SaaSAdmin.tsx choke-point bypass —  | 50 | panel | frontend |

_Sinyal kaynakları: critic (completeness gap) · panel (open finding) · drift (HARD) · backlog (lane next). Consensus-boost: çok-kaynak/çok-kez = yüksek öncelik._
