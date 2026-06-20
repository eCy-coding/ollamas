# Reçete — Observability feed (vT6): tünel → orchestration cockpit

> Tünel lane switch kararlarını **secret-free JSONL feed**'e yazar; orchestration lane (cockpit)
> bunu salt-okuma tüketir. **Cross-lane choke-point = dosya** — orchestration tünel kodunu, tünel
> orchestration kodunu DÜZENLEMEZ (Scope Law). Yalnız bu dosya formatı sözleşmedir.

## Feed dosyası

```
~/Desktop/ollamas/tunnel/keys/decisions.jsonl   (gitignored, 0600, append-only)
```

`tunnel auto`, `tunnel select`, `tunnel status` her çalıştığında bir satır eklenir (best-effort).

## Satır şeması (her satır bir DecisionRecord)

```json
{
  "ts": 1781956037475,
  "winner": "caddy-tls",
  "switched": false,
  "reason": "hold active caddy-tls (best)",
  "scores": [
    { "name": "caddy-tls", "priority": 10, "healthy": true, "latencyMs": 12, "breaker": "closed", "score": 22 },
    { "name": "wireguard", "priority": 20, "healthy": true, "latencyMs": 40, "breaker": "closed", "score": 240 },
    { "name": "headscale", "priority": 20, "healthy": false, "latencyMs": null, "breaker": "open", "score": null }
  ]
}
```

**Secret-free garanti (RISK-TUNNEL-013):** yalnız transport adı/priority/health/latency/breaker/score/reason.
Anahtar, preauth-key, URL-credential, private-key **ASLA** yazılmaz.

## Orchestration tarafı (cockpit, tünel kodu düzenlemeden)

```bash
# canlı tail → SSE / collect.ts'e besle (orchestration lane'de):
tail -f ~/Desktop/ollamas/tunnel/keys/decisions.jsonl
# veya son N kararı oku (size-cap: dosya büyürse tail -n):
tail -n 50 .../keys/decisions.jsonl | while read -r line; do echo "$line"; done
```

- Boş/yok dosya → cockpit zarifçe "tunnel: no data" gösterir (feed opt-in).
- `tunnel status --json` aynı veriyi tek-atış verir (cockpit periyodik poll alternatifi).
- Büyüme (RISK-TUNNEL-018): okuma `tail -n`/`readDecisions({limit})` ile sınırlanır; tam log rotation vT8.

## Cross-lane disiplin

- Tünel lane yalnız feed dosyasını **yazar** + bu reçeteyi tutar.
- Orchestration lane yalnız feed dosyasını **okur** (kendi worktree'sinde collect/serve).
- İki taraf da diğerinin kaynağını düzenlemez (RISK-TUNNEL-002 + Scope Law).
