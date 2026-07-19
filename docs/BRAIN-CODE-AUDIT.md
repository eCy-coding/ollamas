# BRAIN-CODE-AUDIT — ölü-kod denetimi (2026-07-19T22:57)

Rapor-only (silme yok). Orphan = hiçbir modül import etmiyor (entry-point'ler hariç). "Yalnız-test" = sadece test dosyalarından kullanılıyor.

## Orphan modüller (0)
- yok

## Dış-kullanımı olmayan export (43) — dosya-içi kullanılıyor olabilir; bulgu "export gereksiz" demektir, "ölü kod" değil
- server/ai.ts → LOCAL_CODER_HINT
- server/ai.ts → resolveLocalCoder
- server/ai.ts → hasGeminiKey
- server/artifacts.ts → ARTIFACTS_DIR
- server/artifacts.ts → loadManifest
- server/artifacts.ts → resolveBinary
- server/brain-bridges.ts → writeCursor
- server/brain-system.ts → collectSystem
- server/brain.ts → rrfFuseMany
- server/brain.ts → TIER_HALF_LIFE_DAYS
- server/contract.ts → InviteError
- server/contract.ts → _resetFleetCacheForTests
- server/cookbook.ts → RECIPE_TIMEOUT_MS
- server/cookbook.ts → detectSystemInfo
- server/db.ts → masterKeyService
- server/ecym.ts → DEFAULT_ECYM_BASE
- server/ecym.ts → ECY_PRINCIPLES
- server/ecym.ts → getCurrentSystem
- server/ecym.ts → readBench
- server/ecym.ts → detectSys
- server/github-app.ts → _resetAppTokenCache
- server/github-search-standard.ts → CATEGORY_RATIONALE
- server/github-search.ts → SEARCH_TYPES
- server/github.ts → ghRequestAnon
- server/github.ts → getRepo
- server/host-bridge.ts → bridgeHeaders
- server/jobs.ts → rowToJob
- server/key-doctor.ts → defaultReaders
- server/panel-assist.ts → ECY_BASE
- server/process-guards.ts → installProcessGuards
- server/semantic-cache.ts → isSemanticCacheEnabled
- server/semantic-cache.ts → _resetSemanticCacheForTest
- server/tool-interceptors.ts → interceptorNames
- scripts/brain-coherence-audit.ts → ANCHORS
- scripts/brain-teach-datasets.ts → buildReactRecords
- scripts/brain-teach-datasets.ts → buildSecurityRecords
- scripts/brain-teach-datasets.ts → buildCssRecords
- scripts/brain-teach-datasets.ts → buildNetDeepRecords
- scripts/brain-teach-datasets.ts → buildEditorRecords
- scripts/brain-teach-datasets.ts → buildEnWritingRecords

## Yalnız-test export (233)
- server/agent-events.ts → formatSseError
- server/agent-events.ts → isSessionStalled
- server/agent-events.ts → isStreamTimeout
- server/agent-events.ts → formatSseComment
- server/ai.ts → NO_LOCAL_MODEL_HELP
- server/ai.ts → _resetDefaultModelCache
- server/ai.ts → resolveDefaultModel
- server/ai.ts → pickEngine
- server/alignment.ts → parseAlignmentSelection
- server/analyzer.ts → computeGaps
- server/brain-bridges.ts → readCursor
- server/brain-bus.ts → budgetCap
- server/brain-bus.ts → resetBusForTests
- server/brain-consistency.ts → checkConsistency
- server/brain-redact.ts → resolveRedactMode
- server/brain-shadow.ts → rbo
- server/brain-system.ts → snapshotToFacts
- server/brain-system.ts → snapshotSummary
- server/brain-system.ts → wantsLiveSystem
- server/brain.ts → rrfFuse
- server/brain.ts → tierRecency
- server/brain.ts → usageBoost
- server/brain.ts → contradictionSignal
- server/brain.ts → entityOverlap
- server/bridge-hmac.ts → HMAC_WINDOW_MS
- server/bridge-hmac.ts → canonicalMessage
- server/bridge-hmac.ts → verifyRequest
- server/capability-cache.ts → resetToolSupport
- server/cloudflare.ts → parseCloudflareAccounts
- server/contract.ts → notifyPendingApplicant
