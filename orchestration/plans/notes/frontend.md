# frontend — teşhis notları

> Hedef: src/{App.tsx,components,hooks}. Makine `frontend.detected.json` (vO4.1): 13 raw fetch + 2 oversized.

## 1. Choke-point bypass — apiClient dışı raw fetch (13 component)

scan.ts 13 componentin `src/lib/apiClient.ts` choke-point'ini atlayıp doğrudan `fetch()` çağırdığını
buldu (frontend lane vF6 raw-fetch-ban'ı ihlali). İstisna: GoogleDriveBrowser harici Google API'ye
gider (apiClient kapsamı dışı, not'la işaretle).

```note
{
  "id": "frontend-frontend-1",
  "persona": "frontend", "targetLane": "frontend",
  "targetPath": "src/components", "severity": "med", "confidence": "asserted",
  "finding": "13 component apiClient choke-point'ini atlayıp raw fetch çağırıyor (vF6 ban ihlali)",
  "evidence": [{ "path": "src/App.tsx", "lineHint": "-", "fact": "raw fetch(/api/health) apiClient dışı" }],
  "solution": {
    "summary": "Tüm HTTP'yi src/lib/apiClient.ts üzerinden geçir (tek choke-point: auth header, retry, base-url, error). ESLint no-restricted-syntax ile raw fetch'i CI'de banla (frontend lane'de zaten kural var → kapsamı genişlet). Veri-çekme için TanStack Query merkezi client deseni.",
    "refs": [
      { "repo": "eslint/eslint", "license": "MIT", "url": "https://github.com/eslint/eslint", "kind": "copy" },
      { "repo": "TanStack/query", "license": "MIT", "url": "https://github.com/TanStack/query", "kind": "idea" }
    ]
  },
  "minRefs": 2, "status": "open",
  "debate": { "challenges": [], "support": [], "verdict": "GoogleDriveBrowser harici-API istisnası ayrı değerlendir" },
  "source": "authored"
}
```

## 2. Oversized component (ReactAgentTab 764, MultiAgentPipeline 533)

```note
{
  "id": "frontend-frontend-2",
  "persona": "frontend", "targetLane": "frontend",
  "targetPath": "src/components/ReactAgentTab.tsx", "severity": "low", "confidence": "asserted",
  "finding": "ReactAgentTab 764 + MultiAgentPipeline 533 satır — tek-sorumluluk aşımı, bakım yükü",
  "evidence": [{ "path": "src/components/ReactAgentTab.tsx", "lineHint": "-", "fact": "764 satır" }],
  "solution": {
    "summary": "Alt-component + custom hook'lara böl (container/presentational ayrımı). State'i hook'a çıkar. 400 satır eşiğini size-limit gibi CI gate'e bağla.",
    "refs": [
      { "repo": "ai/size-limit", "license": "MIT", "url": "https://github.com/ai/size-limit", "kind": "idea" },
      { "repo": "jsx-eslint/eslint-plugin-react", "license": "MIT", "url": "https://github.com/jsx-eslint/eslint-plugin-react", "kind": "ref-only" }
    ]
  },
  "minRefs": 2, "status": "open",
  "debate": { "challenges": [], "support": [], "verdict": "" },
  "source": "authored"
}
```
