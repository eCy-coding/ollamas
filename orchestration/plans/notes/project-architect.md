# project-architect — teşhis notları

> Hedef: repo kökü, package.json, project_cortex.md, backend/ orphan dizinleri.
> Makine bulguları `project-architect.detected.json`'dan; çözüm + OSS-ref burada insan-yazımı.

## 1. backend/ orphan dizinleri (contracts/daemon/mesh/orchestrator/sandbox)

`scan.ts` 5 dizinin de kaynak ağacında (`src/server/bin/scripts`) tırnak-içi import referansı
olmadığını doğruladı (false-negative düzeltmesi sonrası, ERR-ORCH-006). `server/orchestrator.ts`
gerçek modül; `backend/orchestrator` ondan AYRI bir orphan iskelet.

```note
{
  "id": "project-architect-backend-orphans",
  "persona": "project-architect", "targetLane": "backend",
  "targetPath": "backend/", "severity": "med", "confidence": "asserted",
  "finding": "backend/{contracts,daemon,mesh,orchestrator,sandbox} orphan — hiçbir import yok (unused-code §7)",
  "evidence": [{ "path": "backend/mesh", "lineHint": "-", "fact": "inbound quoted-import ref = 0 (5 dizin)" }],
  "solution": {
    "summary": "Dead-code teyidi sonrası sil VEYA ROADMAP'e gerçek owner+plan bağla. git mv ile arşivle, knip/ts-prune ile CI'de orphan-export gate kur ki yeniden birikmesin.",
    "refs": [
      { "repo": "webpro-nl/knip", "license": "ISC", "url": "https://github.com/webpro-nl/knip", "kind": "ref-only" },
      { "repo": "nadeesha/ts-prune", "license": "MIT", "url": "https://github.com/nadeesha/ts-prune", "kind": "copy" }
    ]
  },
  "minRefs": 2, "status": "open",
  "debate": { "challenges": [], "support": [], "verdict": "" },
  "source": "authored"
}
```

## 2. package.json metadata uyumsuzluğu (name + version)

```note
{
  "id": "project-architect-repo-1",
  "persona": "project-architect", "targetLane": "repo",
  "targetPath": "package.json", "severity": "low", "confidence": "asserted",
  "finding": "package.json name=\"react-example\" + version=\"0.0.0\" — release-please/server.json ile uyumsuz",
  "evidence": [{ "path": "package.json", "lineHint": "name/version", "fact": "placeholder ad + 0.0.0" }],
  "solution": {
    "summary": "name'i 'ollamas'a, version'ı server.json ile aynı semver'e çek. release-please zaten var → manifest'e package.json ekle ki sürüm otomatik bump'lansın, drift bitsin.",
    "refs": [
      { "repo": "googleapis/release-please", "license": "Apache-2.0", "url": "https://github.com/googleapis/release-please", "kind": "copy" },
      { "repo": "npm/node-semver", "license": "ISC", "url": "https://github.com/npm/node-semver", "kind": "idea" }
    ]
  },
  "minRefs": 2, "status": "open",
  "debate": { "challenges": [], "support": [], "verdict": "" },
  "source": "authored"
}
```
