# 17-KAYNAK-KOD-ORNEKLERI — implementation cookbook (research-backed)

> Kodlama oturumlarının çektiği referans. Her giriş: `[M-xxx · Vn] Başlık` → pattern + minimal kod
> örneği + **canlı fetch edilmiş kaynak URL** + doğrulama-durumu. 3 paralel research-agent (WebSearch+
> WebFetch) topladı. **Uydurma-URL yasak (00-ANAYASA §10); doğrulanamayan "⚠ doğrulanamadı" işaretli.**
> Kod örnekleri ILLÜSTRATİF — ollamas'ın mevcut pattern'ine (11-MIMARI) uyarlanarak kullanılır.
> Damga: 2026-07-10 · c5ac42d.

---

## §A — Provider & Model (V2, V7)

### [M-031 · V2] OpenAI-compatible custom provider seam
Tüm OpenAI-uyumlu backend'ler (LM Studio/vLLM/litellm/Groq/Ollama) aynı SDK'yı `baseURL`+`apiKey`
override ile paylaşır — tek fabrika, provider'a göre iki alan değişir. Yerel motorlar `apiKey` placeholder
kabul eder; Ollama v1 base'i `/v1/` ile biter. **ollamas'ta `providers.ts:1334` custom-openai seam ile
örtüşür** → `ReactAgentTab.tsx:211` dropdown'a preset ekle.

```ts
const PRESETS = {
  ollama:   { baseURL: "http://localhost:11434/v1/", apiKey: "ollama" },
  lmstudio: { baseURL: "http://localhost:1234/v1",   apiKey: "lm-studio" },
  vllm:     { baseURL: "http://localhost:8000/v1",   apiKey: "EMPTY" },
  groq:     { baseURL: "https://api.groq.com/openai/v1", apiKey: env.GROQ_KEY },
};
const c = new OpenAI({ baseURL: userBaseUrl, apiKey: userKey });
await c.chat.completions.create({ model, messages });
```
Kaynak: https://docs.ollama.com/api/openai-compatibility · Doğrulama: ✅ teyit (Ollama docs)

### [M-037 · V2] Ollama pull stream + first-run onboarding
`POST /api/pull` NDJSON stream döner (`{status,total,completed,digest}`). Model yoksa `/api/chat` 404 →
onboarding'e yönlendir, `completed/total` ile progress. ollamas'ta `ai.ts:77` throw yerine bu akış.

```ts
async function pullModel(model: string, onProgress: (p: number) => void) {
  const res = await fetch("http://localhost:11434/api/pull",
    { method: "POST", body: JSON.stringify({ model, stream: true }) });
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop() ?? "";
    for (const l of lines) { if (!l.trim()) continue;
      const j = JSON.parse(l);
      if (j.total) onProgress(j.completed / j.total);
      if (j.status === "success") return; }
  }
}
```
Kaynak: https://github.com/ollama/ollama/blob/main/docs/api.md · Doğrulama: ✅ teyit

### [M-039 · V7] Ollama create / Modelfile / GGUF import
Kullanıcı GGUF'unu `FROM /abs/path.gguf` ile içe aktarır. **ÖNEMLİ:** yerel-GGUF `/api/create`'te
`files:{name:"sha256:..."}` + önceden `/api/blobs` upload gerektirir → **CLI `ollama create ad -f Modelfile`
daha pratik**. Doküman (M-039 `docs/custom-model.md`) CLI yolunu önersin.

```
# Modelfile
FROM /Users/x/models/qwen.gguf
PARAMETER temperature 0.7
PARAMETER num_ctx 8192
SYSTEM """You are a helpful assistant."""
```
```bash
ollama create my-qwen -f Modelfile   # sonra ollamas /api/tags'te görünür
```
Kaynak: https://github.com/ollama/ollama/blob/main/docs/modelfile.mdx · https://github.com/ollama/ollama/blob/main/docs/import.mdx · Doğrulama: ✅ teyit (API blob-upload nüansı doc'tan çıkarım)

### [M-038 · V7] Per-model options (num_ctx/temperature/keep_alive/system)
`/api/chat` `options` objesi runtime ayar; `keep_alive` top-level (RAM'de tutma: `"10m"`/`0`/`-1`);
`system` `role:"system"` ilk mesaj. Per-request override varsayılanı ezer. ollamas'ta `providers.ts:933`
`config.numCtx` zaten destekli → UI'dan geçir.

```ts
await fetch("http://localhost:11434/api/chat", { method: "POST", body: JSON.stringify({
  model: "qwen3:8b",
  messages: [{ role: "system", content: "Kısa yanıt." }, { role: "user", content: "Merhaba" }],
  keep_alive: "10m", stream: false,
  options: { num_ctx: 8192, temperature: 0.6, top_p: 0.9 },
})});
```
Kaynak: https://github.com/ollama/ollama/blob/main/docs/api.md · Doğrulama: ✅ teyit

### [M-038/backlog · V7] Provider fallback + latency routing
LiteLLM router modeli: TTL'li pencerede latency izle → en hızlı sağlıklıya yönlendir; hata → sıradaki
provider (cooldown'a al, tüm grubu değil); primary timeout kısa (2s → p95 yarıya). ollamas ROADMAP-vNext
T2.2 (latencyCache reorder) ile örtüşür.

```ts
const ranked = [...providers].sort((a,b)=>(lat.get(a.url)??0)-(lat.get(b.url)??0));
for (const p of ranked) { const t0=performance.now();
  try { const r = await makeClient(p).chat.completions.create({model,messages},{timeout:2000});
        lat.set(p.url, performance.now()-t0); return r; }
  catch { cooldown.add(p.url); } }
```
Kaynak: https://docs.litellm.ai/docs/routing · Doğrulama: ⚠ pattern-seviyesi (kod illüstratif)

---

## §B — Ürün & Release (V1, V6, V8, V9)

### [M-017 · V6] Stripe metered billing test-mode e2e
Billing Meters API: kullanım-başı `meterEvents.create` → metered price ile faturala. Webhook **raw body**
ile `constructEvent` (parse edilmiş JSON imzayı bozar). Test: `generateTestHeaderString` ile ağsız imza.
ollamas `billing/stripe.ts` `sendMeterEventAsync` ile örtüşür.

```ts
await stripe.billing.meterEvents.create({
  event_name: "api_tokens", payload: { value: "25", stripe_customer_id: "cus_XXX" } });

app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  let e; try { e = stripe.webhooks.constructEvent(req.body,
    req.headers["stripe-signature"], env.STRIPE_WEBHOOK_SECRET); }
  catch (err) { return res.status(400).send(`Webhook Error: ${err.message}`); }
  if (e.type === "invoice.paid") { /* rollup */ } res.json({ received: true });
});

// test: ağsız geçerli imza
const payload = JSON.stringify({ id:"evt_1", type:"invoice.paid", data:{object:{}} });
const header = stripe.webhooks.generateTestHeaderString({ payload, secret: whSecret });
stripe.webhooks.constructEvent(payload, header, whSecret); // throw-yok assert
```
Kaynak: https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api · https://github.com/stripe/stripe-node · Doğrulama: ✅ SDK-teyit (docs cURL/Python; TS SDK'da mevcut)

### [M-018 · V6] Lighthouse CI
`lighthouserc.json` collect→assert→upload; Core Web Vitals eşikleri. `lhci autorun` veya
`treosh/lighthouse-ci-action@v12`. ollamas'ta config MEVCUT (`lighthouserc.json`+`budget.json`) → M-018
yalnız RUN+doğrula. Güncel: inline `resource-summary:*` (bytes) budget.json'a alternatif.

```json
{ "ci": {
  "collect": { "numberOfRuns": 5, "url": ["http://localhost:4173/"] },
  "assert": { "assertions": {
    "categories:performance": ["error", { "minScore": 0.9 }],
    "largest-contentful-paint": ["error", { "maxNumericValue": 2500 }],
    "cumulative-layout-shift":  ["error", { "maxNumericValue": 0.1 }],
    "resource-summary:script:size": ["warn", { "maxNumericValue": 300000 }] } },
  "upload": { "target": "temporary-public-storage" } } }
```
Kaynak: https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md · Doğrulama: ✅ teyit

### [M-041 · V9] Keep a Changelog + git-cliff otomasyon
Ters-kronolojik, üstte `Unreleased`, kategoriler Added/Changed/Deprecated/Removed/Fixed/Security, ISO-8601.
Conventional-commit'ten **git-cliff** ile otomasyon. ollamas tag geçmişi v1.21→v1.23 → v1.24+ buradan.

```markdown
# Changelog
## [Unreleased]
### Added
- Custom-openai provider dropdown
## [1.24.0] - 2026-07-10
### Fixed
- README now describes the real product
### Changed
- package name react-example → ollamas
```
```bash
git cliff --tag v1.24.0 -o CHANGELOG.md
```
Kaynak: https://keepachangelog.com/en/1.1.0/ · https://git-cliff.org · https://semver.org · Doğrulama: ✅ teyit

### [M-028 · V1] Contributor Covenant + CONTRIBUTING.md
CoC = Contributor Covenant 2.1 (`[INSERT CONTACT METHOD]` → gerçek iletişim). CONTRIBUTING: dev-setup +
branch/PR + commit-convention + test/lint/type gate.

```markdown
# Contributing
## Dev setup
npm run ready && npm run dev
## Before a PR (quality gate)
npm run lint && vitest run
## Pull requests
- Branch from main, Conventional Commit titles, add tests, keep CI green
```
Kaynak: https://www.contributor-covenant.org/version/2/1/code_of_conduct/code_of_conduct.md · Doğrulama: ✅ CoC teyit · ⚠ GitHub CONTRIBUTING docs URL fetch-edilmedi (yapı awesome-readme'den)

### [M-026 · V1] README best-practice (AI/dev-tool)
Sıra: logo/badge → tek-satır tanım → demo GIF → **Quickstart (kopyala-yapıştır install+ilk-çalıştır)** →
Features → Install → Config/env → Usage → Contributing → License. Çalışan quickstart'la başla, göster-anlatma.

Örnek repolar (awesome-readme): `httpie/httpie`, `gofiber/fiber`. Şablonlar: Standard Readme, makeareadme.
Kaynak: https://github.com/matiassingers/awesome-readme · https://www.makeareadme.com · Doğrulama: ✅ teyit

---

## §C — DX & Güvenlik (V3, V4)

### [M-029 · V3] MCP tool authoring (server-side)
MCP TS SDK: `server.registerTool(name, {title,description,inputSchema(Zod),outputSchema,annotations},
handler)`. SDK input'u handler'dan önce doğrular; handler `CallToolResult` döner. Tier = **annotations**
(`readOnlyHint/destructiveHint/idempotentHint/openWorldHint`) — ipuçları advisory, kendi tier-check'ini
handler'da uygula. ollamas `tool-registry.ts:43` ToolTier ile eşle (safe→readOnly, privileged→destructive).

```ts
server.registerTool("calc-bmi",
  { title:"BMI", description:"Body Mass Index",
    inputSchema: z.object({ weightKg: z.number(), heightM: z.number() }),
    annotations: { readOnlyHint: true, openWorldHint: false } },  // tier sinyali
  async ({ weightKg, heightM }) => ({
    content: [{ type:"text", text:`BMI: ${(weightKg/(heightM**2)).toFixed(2)}` }] }));
```
Kaynak: https://github.com/modelcontextprotocol/typescript-sdk · Doğrulama: ✅ teyit

### [M-001 · V4] Express auth-boundary testing (supertest + vitest)
Gerçek `app`'i import et, supertest ile sür. Korunan route → token'sız 403, public → 200. SaaS modu
env ile app-import'tan ÖNCE toggle. ollamas `localOwnerGuard` (server.ts:276) testi için.

```ts
import request from "supertest";
beforeAll(() => { process.env.SAAS_ENFORCE = "1"; });
const { app } = await import("../server.js"); // env import-anında okunur

it("SaaS'ta korunan prefix 403", async () => {
  await request(app).get("/api/terminal").expect(403); });
it("public route geçer", async () => {
  await request(app).get("/api/health").expect(200); });
```
Kaynak: https://codoid.com/api-testing/supertest-the-ultimate-guide-to-testing-node-js-apis/ · Doğrulama: ⚠ supertest+Vitest+SaaS-env tam kombinasyonu doğrulanamadı; supertest API teyit

### [M-009 · V4] ReDoS: RE2 + escape + anchor
`new RegExp(userInput)` catastrophic-backtracking DoS. Fix: untrusted input'u derleme; dinamikse escape +
anchor + **linear-time RE2** (`re2` paketi). Semgrep `detect-non-literal-regexp` taint-mode ile FP azaltır.
ollamas `threatfeed.ts:72` dynamic RegExp için — `name` user-controlled ise RE2.

```ts
import RE2 from "re2";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const re = new RE2(`^${escape(userInput)}$`); // anchored + escaped + linear
```
Kaynak: https://semgrep.dev/r/javascript.lang.security.audit.detect-non-literal-regexp · Doğrulama: ✅ teyit

### [M-003 · V4] command-injection guard (execFile vs exec)
`exec` `/bin/sh` açar → `;|$()`backtick çalışır. `execFile` binary'yi doğrudan argv-array ile çalıştırır —
shell yok, metachar inert. Allowlist + path-traversal guard ekle. **ollamas `commander.ts:46` bunu ZATEN
yapıyor** (M-003 = regresyon testi, kod FP).

```ts
import { execFile } from "node:child_process"; import path from "node:path";
const ALLOWED = new Set(["status","log","diff"]);
export function runGit(sub: string, file: string) {
  if (!ALLOWED.has(sub)) throw new Error("subcommand not allowed");
  const safe = path.resolve("/repo", file);
  if (!safe.startsWith("/repo/")) throw new Error("path traversal");
  return execFile("git", [sub, "--", safe], { shell: false }); // injection-proof
}
```
Kaynak: https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/avoid-command-injection-node.md · Doğrulama: ✅ teyit

### [M-030 · V3] Extension Guide yapısı (VS Code modeli)
En iyi yapı (VS Code): (a) Extension Anatomy — activation + contribution points + API yüzeyi;
(b) Contribution Points — declarative manifest (`contributes`); (c) per-point referans (id/schema/örnek);
(d) çalışan sample repo (kavram-başı bir örnek). ollamas için: tool/plugin kaydı = manifest + stable
`registerTool` API + tier sözleşmesi (MCP annotation + Obsidian `onload/registerX` modeli).

```ts
export interface OllamasPlugin {
  id: string;                 // kebab-case, unique
  tools?: ToolDef[];          // declarative, JSON-schema input
  onActivate?(ctx: PluginContext): void | Promise<void>;
}
```
Kaynak: https://code.visualstudio.com/api/references/contribution-points · https://code.visualstudio.com/api/get-started/extension-anatomy · Doğrulama: ✅ teyit

---

## Doğrulama özeti

| Durum | Girişler |
|---|---|
| ✅ teyit (canlı fetch, birincil kaynak) | M-031, 037, 039, 038, 017, 018, 041, 026, 029, 009, 003, 030 (12) |
| ⚠ kısmi/pattern-seviyesi | fallback-routing (illüstratif), M-028 (GitHub docs URL fetch-edilmedi), M-001 (supertest+Vitest+SaaS tam-kombo) |

**Kullanım kuralı:** kodlama oturumu bu örneği ollamas'ın mevcut pattern'ine (11-MIMARI + ilgili anchor)
uyarlar; verbatim kopyalamaz. ⚠ girişler için kodlama-anında ek doğrulama yap (00-ANAYASA §10 P-C).
