# <persona> — teşhis notları

> İnsan-yazımı OSS-referanslı çözüm notları. Her not bir ` ```note ` fenced JSON bloğudur;
> `note.ts` bunları deterministik parse eder. Blok DIŞINDAKİ metin = serbest dokümantasyon.
> KURAL: `solution.refs` ≥ `minRefs` (varsayılan 2) olmalı; yetersizse panel `refDeficit` flag'ler.
> Detector'ın ürettiği `<persona>.detected.json` bulguları buraya çözüm + ref ile zenginleştirilir.

```note
{
  "id": "<persona>-<lane>-1",
  "persona": "<persona>",
  "targetLane": "backend",
  "targetPath": "project_cortex.md",
  "severity": "med",
  "confidence": "asserted",
  "finding": "Bir cümlede ne bozuk/zayıf.",
  "evidence": [
    { "path": "project_cortex.md", "lineHint": "1", "fact": "dosya boş / 0 girdi" }
  ],
  "solution": {
    "summary": "Önerilen çözüm (kısa). Vibe-code yok — OSS desen referansı ver.",
    "refs": [
      { "repo": "owner/repo", "license": "MIT", "url": "https://github.com/owner/repo", "kind": "copy" },
      { "repo": "owner/repo2", "license": "Apache-2.0", "url": "https://github.com/owner/repo2", "kind": "idea" }
    ]
  },
  "minRefs": 2,
  "status": "open",
  "debate": { "challenges": [], "support": [], "verdict": "" },
  "source": "authored"
}
```

## Notlar (serbest doküman)
- `kind`: MIT/Apache/BSD → `copy` (kopya+attribution); GPL/bilinmeyen → `ref-only`; konsept → `idea`.
- `targetHash` + `ts` araç tarafından stamp'lenir (boş bırak).
- Aynı bulguyu ≥2 persona bağımsız tespit ederse `rank.ts` consensus boost uygular.
