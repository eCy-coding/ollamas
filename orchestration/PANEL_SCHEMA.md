# PANEL_SCHEMA — vO4 Expert Diagnostic Panel sözleşmesi

> Bu sekme (orchestration) **lane kodunu YAZMAZ** (§3). Panel, ollamas lane'lerini READ-ONLY tarar,
> bozuk/zayıf yerleri **teşhis notu** olarak üretir, OSS-kaynaklı çözüm önerir, **rapor** eder.
> Pattern adoption: `spencermarx/open-code-review` (Apache-2.0) — Tech-Lead → persona takımı →
> paralel inceleme → discourse → sentez. **CANLI LLM AGENT spawn EDİLMEZ**; discourse bir dosya
> konvansiyonudur, process değil.

## 1. Akış (4 faz, dosya konvansiyonu)

1. **Assemble** — `bin/lib/personas.ts` registry: 8 persona → sahip-olduğu scan target'lar.
2. **Parallel review** — `bin/scan.ts <persona>` deterministik fact toplar →
   `plans/notes/<persona>.detected.json`. İnsan, OSS-referanslı çözümü `plans/notes/<persona>.md` yazar.
   Persona'lar paylaşımlı state KULLANMAZ (bağımsız bakış = farklı dikkat = farklı bulgu).
3. **Discourse** — notlar `debate.challenges` / `debate.support` ile çapraz-`noteId` ref'ler;
   `plans/notes/DISCOURSE.md` ledger'ında persona'lar birbirinin notunu çürütür/destekler.
4. **Synthesis** — `bin/panel.ts` → `rank.ts` ile sentez → `plans/PANEL_REPORT.md` + `plans/panel-report.json`.

## 2. DiagnosticNote (JSON şema — alanlar)

| Alan | Tip | Açıklama |
|---|---|---|
| `id` | string | `<persona>-<lane>-<n>` (benzersiz, dedup anahtarı parçası) |
| `persona` | enum | 8 persona'dan biri (§4) |
| `targetLane` | string | backend\|frontend\|cli\|scripts\|integrations\|bench\|orchestration\|repo |
| `targetPath` | string | bulgunun dosya/dizin yolu (ANCHOR'a göreli) |
| `severity` | enum | `blocker`>`high`>`med`>`low`>`info` |
| `confidence` | enum | `detected` (makine kanıtı) \| `asserted` (insan iddiası) |
| `finding` | string | ne bozuk/zayıf (tek cümle) |
| `evidence` | `{path,lineHint,fact}[]` | makine-tespit kanıtı (detector üretir) |
| `solution` | `{summary, refs[]}` | insan-yazımı OSS-referanslı çözüm |
| `solution.refs[]` | `{repo,license,url,kind}` | `kind`: `copy`(MIT/Apache/BSD)\|`ref-only`(GPL/bilinmeyen)\|`idea` |
| `minRefs` | number | varsayılan 2; `refs.length<minRefs` → `refDeficit` |
| `status` | enum | `open`\|`triaged`\|`adopted`\|`rejected` |
| `debate` | `{challenges[],support[],verdict}` | çapraz-persona discourse (noteId ref'leri) |
| `source` | enum | `detected`\|`authored` |
| `targetHash` | string | targetPath içerik/HEAD hash (drift/stale tespiti — vO8 köprü) |
| `ts` | string | ISO timestamp (üretici dışında stamp'lenir) |

## 3. PanelReport (aggregation)

```
{ ts, personaCoverage:{persona:count}, byLane:{lane:count},
  ranked:[noteId...],                 // severity↓ + consensus boost
  duplicatesMerged:number,            // çapraz-persona dedup sayısı
  consensusBoosted:[noteId],          // ≥2 persona aynı bulgu → severity↑
  unresolvedDebates:[noteId],         // ≥2 challenge + unsupported
  refDeficit:[noteId],                // refs<minRefs (kaynak yetersiz)
  stale:[noteId],                     // targetHash≠canlı (drift)
  totals:{ bySeverity:{...}, open, adopted } }
```

## 4. Persona → scan target eşleme

| Persona | targetLane | Scan target |
|---|---|---|
| `project-architect` | repo | repo root, `package.json`, `project_cortex.md`, `backend/` orphan |
| `prompt-engineer` | repo | `AGENTS.md`, `SEYIR_DEFTERI.md`, `server.ts` system-prompt string |
| `fullstack` | backend | `server.ts`, `src`↔`server` seam |
| `backend` | backend | `server/`, `backend/{contracts,daemon,mesh,orchestrator,sandbox}` |
| `frontend` | frontend | `src/{App.tsx,components,hooks}` |
| `macos` | scripts | `*.sh`, launchd/Terminal, `deploy/` |
| `integrations` | integrations | `.env.example`, webhook/OAuth, `server.json` |
| `mcp` | integrations | tool-registry, `ToolRegistry.execute`, `modelcontextprotocol` |

## 5. Makine-vs-insan sınırı (no vibe-code)

- **TS hesaplar (`confidence:"detected"`):** name/version mismatch, boş-dosya, orphan-dir
  (inbound import yok), referanssız `*.jsonl`, prom-client-var-dashboard-yok (grep simetri).
  Detector yalnız `evidence` + ham `finding` üretir.
- **İnsan yazar (`confidence:"asserted"` / `source:"authored"`):** `solution`, `refs` (≥N OSS kaynak),
  severity gerekçe, debate verdict. **Araç çözüm UYDURMAZ**; kaynak yetersizse `refDeficit` flag'ler.

## 6. Scope law (RISK-ORCH-003)

Detector'lar yalnız `git`/Read/grep kullanır — lane tree'ye **0 yazım**. Panel çıktısı yalnız
`orchestration/plans/` altına yazılır. `tests/panel.test.ts` bunu assert eder.
