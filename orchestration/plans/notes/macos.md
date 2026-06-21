# macos — teşhis notları

> Hedef: *.sh, launchd/Terminal köprüsü, deploy/. Makine `macos.detected.json` (vO4.1): 4 shell-strict.

## 1. Shell scriptler 'set -euo pipefail' eksik (install/setup/uninstall/join-cluster)

scan.ts 4 scriptin strict-mode eksik olduğunu buldu: install/setup/uninstall.sh `set -e` var ama
`-u` + pipefail yok; join-cluster.sh hiçbiri yok → sessiz hata-yutma + tanımsız-değişken riski.

```note
{
  "id": "macos-scripts-1",
  "persona": "macos", "targetLane": "scripts",
  "targetPath": "*.sh", "severity": "low", "confidence": "asserted",
  "finding": "4 shell script 'set -euo pipefail' eksik — sessiz hata-yutma + unset-var riski",
  "evidence": [{ "path": "join-cluster.sh", "lineHint": "1", "fact": "e=false u=false pipefail=false" }],
  "solution": {
    "summary": "Her script'in shebang sonrasına 'set -euo pipefail' ekle (bash strict mode). CI'de ShellCheck (SC2086 unquoted, SC2164 cd-fail) gate'i koş — frontend lhci deseni gibi. ShellCheck GPL-3.0 → BİNARİ kullan (kod kopyalama), kural-fikri serbest.",
    "refs": [
      { "repo": "koalaman/shellcheck", "license": "GPL-3.0", "url": "https://github.com/koalaman/shellcheck", "kind": "ref-only" },
      { "repo": "sindresorhus/awesome-bash (strict-mode)", "license": "CC0", "url": "https://github.com/awesome-lists/awesome-bash", "kind": "idea" }
    ]
  },
  "minRefs": 2, "status": "open",
  "debate": { "challenges": [], "support": [], "verdict": "" },
  "source": "authored"
}
```
