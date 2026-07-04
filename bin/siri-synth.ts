// siri-synth — stdin'deki prompt'u FLEET üzerinden kısa Türkçe yanıta çevirir (Siri sentez adımı).
// provider:"fleet" → rutin qwen3:8b BOŞ Windows CUDA worker'da koşar (Mac 503'ünü by-pass eder);
// Windows yoksa fleet zinciri Mac-local → cloud → demo'ya düşer (siri-ask demo'yu yakalar). Server boot GEREKMEZ.
// İZLEME: SIRI_TRACE=1 → kullanılan backend (r.source) stderr'e (⟦SYNTH⟧ <source>) → hangi GPU/yedek kanıtı.
import { ProviderRouter } from "../server/providers";

let s = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (s += d));
process.stdin.on("end", async () => {
  try {
    const r = await ProviderRouter.generate({
      provider: "fleet",
      model: "qwen3:8b",
      messages: [{ role: "user", content: s }],
      temperature: 0.3,
    });
    process.stderr.write("⟦SYNTH⟧ " + (r.source || "?") + "\n");
    process.stdout.write(r.text || "");
  } catch {
    process.stderr.write("⟦SYNTH⟧ error\n");
    process.stdout.write("");
  }
});
