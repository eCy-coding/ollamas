# Claude → ollamas → odysseus — Kalıcı $0 Entegrasyon Zinciri

Claude Code, ollamas'ı **%100** kullanır; ollamas, PewDiePie odysseus'unu **%100** kullanır. Hepsi cloud, **$0**, reboot-kalıcı. Kuruldu + canlı kanıtlandı 2026-07-12.

```
Claude Code ──MCP/http──▶ ollamas :3000/mcp ──stdio bridge──▶ odysseus :7860 ──▶ pollinations (keyless $0)
 (.mcp.json)              (com.ollamas.server)   (tools.json)    (com.odysseus.server)
                              ▲                                          │
                              └──── 20 tool (odysseus da ollamas'ı tüketir) ◀── çift-yönlü
```

## Bileşenler (hepsi launchd-kalıcı)
| Servis | Port | launchd | Not |
|--------|------|---------|-----|
| ollamas | 3000 | `com.ollamas.server` | MCP gateway + 68 tool expose |
| odysseus | 7860 | `com.odysseus.server` | no-auth headless (`run-headless.sh`), cloud model |
| chroma | 8100 | (wrapper başlatır) | odysseus vektör store |

## Nasıl kullanılır (Claude'dan)
- `.mcp.json` → `ollamas: http://127.0.0.1:3000/mcp`. Yeni Claude Code oturumunda `claude mcp list` → `ollamas ✓`.
- ollamas'ın kendi 40 tool'u + consumed upstream'ler (odysseus/fs/memory/thinking/everything/ukp...) `mcp__<server>__<tool>` olarak gelir.
- Odysseus çağrısı: `mcp__odysseus__odysseus_chat` / `_research` / `_agent_task` / `_health`.

## Kritik ayarlar (bir defa yapıldı)
- `.env`: `MCP_EXPOSE_TIERS=safe,host,privileged,host_upstream` — consumed-upstream (odysseus) tool'larını /mcp'de expose eder. **Bu olmadan Claude odysseus'u göremez.**
- `tools.json` odysseus bridge: `ODYSSEUS_URL=http://127.0.0.1:7860`, `ODYSSEUS_MODEL=openai-fast`, `ODYSSEUS_ENDPOINT_ID=eef6b03e`.
- odysseus model-endpoint: pollinations keyless (`https://text.pollinations.ai/openai`) → $0, local ollama yüklemez.
- `server.ts:938`: MCP-consume non-blocking boot → boot ~2dk yerine **~8s**.

## Sağlık kontrolü (tek komut)
```bash
launchctl list | grep -E "odysseus|ollamas.server"          # ikisi MANAGED
curl -s 127.0.0.1:7860/api/health                            # odysseus healthy
curl -s 127.0.0.1:3000/api/mcp/upstreams | grep -c odysseus  # 4 tool expose
```

## E2E kanıt (tekrar üretilebilir)
`node` ile MCP client → `:3000/mcp` → tools/list (cursor takip et, sayfalı) → `callTool mcp__odysseus__odysseus_chat` → cloud yanıt. Kanıtlanan token: `CLAUDE_OLLAMAS_ODYSSEUS_OK`.

**Not:** ollamas `/mcp` tools/list sayfalar (~50/sayfa); odysseus tool'ları 2. sayfada — düzgün MCP client (Claude) otomatik cursor takip eder.
